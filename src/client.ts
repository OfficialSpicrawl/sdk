import { Transport, withMeta, type ClientOptions, type RequestOptions } from "./core.js";
import { Batch } from "./resources/batch.js";
import { Brand } from "./resources/brand.js";
import { Browser } from "./resources/browser.js";
import { Monitors } from "./resources/monitors.js";
import { Partner } from "./resources/partner.js";
import { Requests } from "./resources/requests.js";
import { Sessions } from "./resources/sessions.js";
import { Usage } from "./resources/usage.js";
import { Webhooks } from "./resources/webhooks.js";
import type { KeyInfo, ResponseFormat, ResponseMeta, ScrapeEnvelope, ScrapeRequest, WithMeta } from "./types.js";

/** Params for `feedback()`. `requestId` is the failed request's id: `err.requestId`, or `_meta.requestId`. */
export interface FeedbackParams {
  requestId: string;
  /** Default `"down"`. A thumbs-down on a charged request refunds its credits, up to a daily cap. */
  rating?: "up" | "down";
  kind?: "broken" | "wrong_result" | "missing" | "confusing" | "other";
  impact?: "blocked" | "worked_around" | "friction";
  /** What you were trying to do. Up to 300 characters. */
  intent?: string;
  /** Up to 4000 characters. */
  comment?: string;
  /** The agent or client that made the request. Up to 200 characters. */
  agent?: string;
}

/** Result of `feedback()`. */
export interface FeedbackResult {
  feedbackId: string;
  /** True when this request already had feedback; nothing new was recorded. */
  alreadySubmitted: boolean;
  /** Credits refunded by this call. */
  creditsRefunded: number;
  /** True when the daily refund cap has been reached, so no credits were refunded. */
  refundCapReached: boolean;
}

interface FeedbackResponse {
  feedback_id: string;
  already_submitted: boolean;
  credits_refunded: number;
  refund_cap_reached: boolean;
}

/** Params for `scrape()`: everything except a non-JSON `response_format`. */
export type ScrapeParams = Omit<ScrapeRequest, "response_format"> & { response_format?: "json" };

/**
 * Result of `scrapeRaw()`: the body exactly as served, discriminated by `format`.
 * `format` comes from the response Content-Type, so a request coerced to the JSON
 * envelope (extract, screenshot, links, …) reports `"json"` and also carries `envelope`.
 */
export type ScrapeRawResult =
  | { format: "html" | "markdown" | "text"; body: string; contentType: string; targetStatus: number | null; _meta: ResponseMeta }
  | { format: "pdf"; body: ArrayBuffer; contentType: string; targetStatus: number | null; _meta: ResponseMeta }
  | {
      format: "json";
      body: string;
      envelope: ScrapeEnvelope;
      contentType: string;
      targetStatus: number | null;
      _meta: ResponseMeta;
    };

function formatOf(contentType: string): ScrapeRawResult["format"] {
  const ct = contentType.toLowerCase();
  if (ct.includes("application/pdf")) return "pdf";
  if (ct.includes("json")) return "json";
  if (ct.includes("markdown")) return "markdown";
  if (ct.includes("text/plain")) return "text";
  return "html";
}

/**
 * The Spicrawl API client.
 *
 * ```ts
 * import { Spicrawl } from "@spicrawl/sdk";
 * const spicrawl = new Spicrawl(); // reads SPICRAWL_API_KEY
 * const page = await spicrawl.scrape({ url: "https://example.com", js_render: true });
 * ```
 */
export class Spicrawl {
  /** @internal */
  readonly _transport: Transport;
  readonly batch: Batch;
  readonly sessions: Sessions;
  readonly requests: Requests;
  readonly usage: Usage;
  /** Remote browser — coming soon. */
  readonly browser: Browser;
  /** Partner accounts: workspaces for your end users, one shared balance, tiers. Partner keys only. */
  readonly partner: Partner;
  /** A site's brand assets: logos, colors, fonts, links, from one rendered page load. */
  readonly brand: Brand;
  /** Webhook endpoints that receive signed `batch.*` and `monitor.*` events. */
  readonly webhooks: Webhooks;
  /** Page and site monitors: watch a URL for changes and get notified. */
  readonly monitors: Monitors;

  constructor(options: ClientOptions = {}) {
    this._transport = new Transport(options);
    this.batch = new Batch(this._transport);
    this.sessions = new Sessions(this._transport);
    this.requests = new Requests(this._transport);
    this.usage = new Usage(this._transport);
    this.browser = new Browser(this._transport);
    this.partner = new Partner(this._transport);
    this.brand = new Brand(this._transport);
    this.webhooks = new Webhooks(this._transport);
    this.monitors = new Monitors(this._transport);
  }

  get baseURL(): string {
    return this._transport.baseURL;
  }

  /** What the calling key is: its scopes, environment and organization. Any valid key may call it. */
  key(opts?: RequestOptions): Promise<WithMeta<KeyInfo>> {
    return this._transport.json({ method: "GET", path: "/v1/key" }, opts);
  }

  /**
   * Report a failed request (`POST /v1/feedback`). Pass the failed request's `requestId`.
   * Calling it again for the same request returns `alreadySubmitted: true`.
   *
   * ```ts
   * await spicrawl.feedback({ requestId: err.requestId!, kind: "broken", intent: "scrape a price page" });
   * ```
   */
  async feedback(params: FeedbackParams, opts?: RequestOptions): Promise<WithMeta<FeedbackResult>> {
    const r = await this._transport.json<FeedbackResponse>(
      {
        method: "POST",
        path: "/v1/feedback",
        body: {
          request_id: params.requestId,
          rating: params.rating ?? "down",
          kind: params.kind,
          impact: params.impact,
          intent: params.intent,
          comment: params.comment,
          agent: params.agent,
        },
      },
      opts,
    );
    return withMeta(
      {
        feedbackId: r.feedback_id,
        alreadySubmitted: r.already_submitted,
        creditsRefunded: r.credits_refunded,
        refundCapReached: r.refund_cap_reached,
      },
      r._meta,
    );
  }

  /**
   * Scrape one URL and return the JSON envelope (`POST /v1/scrape` with `response_format: "json"`).
   *
   * `envelope.status` is the TARGET site's status: a site answering 404 is a successful call,
   * not an error. Only platform failures throw.
   *
   * Not idempotent — each call performs and bills a new scrape, so it is retried only when the
   * server provably did no work (429, or a connection that never opened).
   */
  async scrape(params: ScrapeParams, opts?: RequestOptions): Promise<WithMeta<ScrapeEnvelope>> {
    const fmt = (params as { response_format?: string }).response_format;
    if (fmt !== undefined && fmt !== "json") {
      throw new TypeError(`scrape() returns the JSON envelope; use scrapeRaw() for response_format "${fmt}".`);
    }
    return this._transport.json<ScrapeEnvelope>(
      { method: "POST", path: "/v1/scrape", body: { ...params, response_format: "json" } },
      opts,
    );
  }

  /**
   * Scrape one URL and return the body as served: html, markdown or text as a string, pdf as
   * an ArrayBuffer, or the JSON envelope when the request asks for (or is coerced to) JSON.
   * Metadata (credits, engine, target status) is on `_meta`.
   *
   * ```ts
   * const r = await spicrawl.scrapeRaw({ url, response_format: "markdown" });
   * if (r.format === "markdown") console.log(r.body);
   * ```
   */
  async scrapeRaw(
    params: ScrapeRequest & { response_format?: ResponseFormat },
    opts?: RequestOptions,
  ): Promise<ScrapeRawResult> {
    const r = await this._transport.request(
      {
        method: "POST",
        path: "/v1/scrape",
        body: params,
        parse: "auto",
        accept: "application/json, text/html, text/markdown, text/plain, application/pdf",
      },
      opts,
    );
    const format = formatOf(r.contentType);
    const base = { contentType: r.contentType, targetStatus: r.meta.targetStatus, _meta: r.meta };
    if (format === "pdf") {
      const body = r.data instanceof ArrayBuffer ? r.data : new TextEncoder().encode(String(r.data)).buffer;
      return { format, body: body as ArrayBuffer, ...base };
    }
    if (format === "json") {
      const envelope = r.data as ScrapeEnvelope;
      return { format, body: JSON.stringify(envelope), envelope, ...base };
    }
    return { format, body: String(r.data ?? ""), ...base };
  }
}
