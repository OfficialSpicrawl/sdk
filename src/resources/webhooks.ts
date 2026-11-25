import { createHmac, timingSafeEqual } from "node:crypto";
import type { RequestOptions, Transport } from "../core.js";
import { withMeta } from "../core.js";
import type {
  ResponseMeta,
  WebhookDeliveriesParams,
  WebhookDeliveryList,
  WebhookEndpoint,
  WebhookEndpointCreate,
  WebhookEndpointList,
  WebhookEndpointUpdate,
  WebhookEndpointWithSecret,
  WebhookTestResponse,
  WithMeta,
} from "../types.js";

const enc = encodeURIComponent;

/**
 * Webhook endpoints: `/v1/webhooks`. Spicrawl POSTs signed events (`batch.*`, `monitor.*`) to
 * each endpoint. Check each delivery with `verifyWebhookSignature()`.
 */
export class Webhooks {
  constructor(private readonly t: Transport) {}

  /** Register an https endpoint. The response carries its signing `secret`: store it, do not log it. */
  create(body: WebhookEndpointCreate, opts?: RequestOptions): Promise<WithMeta<WebhookEndpointWithSecret>> {
    return this.t.json({ method: "POST", path: "/v1/webhooks", body }, opts);
  }

  /** List your webhook endpoints. */
  list(opts?: RequestOptions): Promise<WithMeta<WebhookEndpointList>> {
    return this.t.json({ method: "GET", path: "/v1/webhooks" }, opts);
  }

  /** Read one endpoint, without its secret. */
  get(id: string, opts?: RequestOptions): Promise<WithMeta<WebhookEndpoint>> {
    return this.t.json({ method: "GET", path: `/v1/webhooks/${enc(id)}` }, opts);
  }

  /** Change the fields you send (`PATCH`). The secret does not change here: use `rotateSecret()`. Setting `enabled: true` clears `disabled_reason`. */
  update(id: string, body: WebhookEndpointUpdate, opts?: RequestOptions): Promise<WithMeta<WebhookEndpoint>> {
    return this.t.json({ method: "PATCH", path: `/v1/webhooks/${enc(id)}`, body }, opts);
  }

  /** Delete an endpoint and its delivery history. */
  async delete(id: string, opts?: RequestOptions): Promise<{ readonly _meta: ResponseMeta }> {
    const r = await this.t.request({ method: "DELETE", path: `/v1/webhooks/${enc(id)}`, parse: "none" }, opts);
    return withMeta({}, r.meta);
  }

  /** Queue a signed `ping` delivery to the endpoint. Returns its `delivery_id`; check it with `deliveries()`. */
  test(id: string, opts?: RequestOptions): Promise<WithMeta<WebhookTestResponse>> {
    return this.t.json({ method: "POST", path: `/v1/webhooks/${enc(id)}/test` }, opts);
  }

  /** Issue a new signing secret. Deliveries after this call are signed with the new one only: update the receiver first or as you rotate. The secret is shown once. */
  rotateSecret(id: string, opts?: RequestOptions): Promise<WithMeta<WebhookEndpointWithSecret>> {
    return this.t.json({ method: "POST", path: `/v1/webhooks/${enc(id)}/rotate-secret` }, opts);
  }

  /** Recent delivery attempts to the endpoint, newest first. `limit` is 1 to 100 (default 20). */
  deliveries(id: string, params: WebhookDeliveriesParams = {}, opts?: RequestOptions): Promise<WithMeta<WebhookDeliveryList>> {
    return this.t.json({ method: "GET", path: `/v1/webhooks/${enc(id)}/deliveries`, query: params }, opts);
  }
}

/** Options for `verifyWebhookSignature()`. */
export interface VerifyWebhookOptions {
  /** Largest allowed gap between the signed timestamp and `now`, in seconds. Default 300. */
  toleranceSeconds?: number;
  /** The current time as a Unix timestamp in seconds. Default: the system clock. */
  now?: number;
}

/**
 * Check a webhook's signature. `header` is the signature header's value,
 * `t=<unix>,v1=<hex>,kid=<n>`. The signature is HMAC-SHA256, keyed with the endpoint's secret
 * (UTF-8), over `"<t>." + rawBody`. Pass the body exactly as received, before any JSON parsing.
 *
 * Returns false for a malformed header, a wrong signature, or a timestamp outside the tolerance.
 * The comparison is constant-time. Synchronous, Node.js only (`node:crypto`).
 */
export function verifyWebhookSignature(
  rawBody: string | Uint8Array,
  header: string,
  secret: string,
  { toleranceSeconds = 300, now }: VerifyWebhookOptions = {},
): boolean {
  let t: string | undefined;
  let v1: string | undefined;
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "t" && t === undefined) t = v;
    else if (k === "v1" && v1 === undefined) v1 = v;
  }
  if (t === undefined || v1 === undefined || !/^\d+$/.test(t) || !/^[0-9a-f]+$/i.test(v1)) return false;

  const clock = now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(clock - Number(t)) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest();
  const given = Buffer.from(v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
