import type { RequestOptions, Transport } from "../core.js";
import { withMeta } from "../core.js";
import { SpicrawlError } from "../errors.js";
import { PagePromise } from "../pagination.js";
import type {
  PartnerCreditAssigned,
  PartnerCreditAssignment,
  PartnerSummary,
  PartnerTier,
  PartnerTierInput,
  PartnerTierList,
  PartnerTierPatch,
  PartnerUsage,
  PartnerUsageParams,
  PartnerUserListParams,
  PartnerWallet,
  PartnerWorkspace,
  PartnerWorkspaceDetail,
  PartnerWorkspaceList,
  PartnerWorkspaceProvisionRequest,
  PartnerWorkspaceProvisioned,
  PartnerWorkspaceUpdate,
  PartnerWorkspaceUsage,
  PartnerWorkspaceUsageParams,
  ResponseMeta,
  WithMeta,
} from "../types.js";

const enc = encodeURIComponent;

/** Params for `users.giveCredits()`. `idempotency_key` is generated when omitted. */
export type GiveCreditsParams = Omit<PartnerCreditAssignment, "idempotency_key"> & { idempotency_key?: string };

/** A random UUID v4 for an idempotency key, from Web Crypto (`randomUUID`, else `getRandomValues`). */
export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  if (typeof c?.getRandomValues === "function") {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  throw new SpicrawlError("No Web Crypto is available to generate an idempotency key: pass idempotency_key.", { status: 0 });
}

/** Drop undefined fields; an empty result means "send no body". */
function definedBody<T extends object>(o: T): T | undefined {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Partner accounts (`/v1/partner`): one workspace per end user, one shared balance, and tiers.
 * Every method takes the partner's key; a workspace's own key cannot call them.
 */
export class Partner {
  /** One workspace per end user. */
  readonly users: PartnerUsers;
  /** The partner's limit sets for its users. */
  readonly tiers: PartnerTiers;

  constructor(private readonly t: Transport) {
    this.users = new PartnerUsers(t);
    this.tiers = new PartnerTiers(t);
  }

  /** The account at a glance: allowance, users and caps, and balance. */
  summary(opts?: RequestOptions): Promise<WithMeta<PartnerSummary>> {
    return this.t.json({ method: "GET", path: "/v1/partner/summary" }, opts);
  }

  /** The balance you can give to users (`balance_credits`), and the credit line. Amounts in credits. */
  balance(opts?: RequestOptions): Promise<WithMeta<PartnerWallet>> {
    return this.t.json({ method: "GET", path: "/v1/partner/wallet" }, opts);
  }

  /** Usage across all your workspaces: one row per day, or one per workspace (`group_by: "workspace"`, paged by `offset`). */
  usage(params: PartnerUsageParams = {}, opts?: RequestOptions): Promise<WithMeta<PartnerUsage>> {
    return this.t.json({ method: "GET", path: "/v1/partner/usage", query: params }, opts);
  }
}

/** The end users of a partner: `/v1/partner/workspaces`. */
export class PartnerUsers {
  constructor(private readonly t: Transport) {}

  /**
   * List your users' workspaces. Await for one page, or `for await` for every user: the
   * default sort follows `next_after`, and `sort: "wallet_used"` follows `next_offset`.
   */
  list(params: PartnerUserListParams = {}, opts?: RequestOptions): PagePromise<PartnerWorkspace, PartnerWorkspaceList, PartnerUserListParams> {
    return new PagePromise(async (p: PartnerUserListParams) => {
      const body = await this.t.json<PartnerWorkspaceList>({ method: "GET", path: "/v1/partner/workspaces", query: p }, opts);
      const next =
        p.sort === "wallet_used"
          ? body.next_offset !== undefined && body.next_offset !== null ? { ...p, offset: body.next_offset } : null
          : body.next_after ? { ...p, after: body.next_after } : null;
      return { items: body.workspaces ?? [], body, meta: body._meta, next };
    }, params);
  }

  /**
   * Create the user's workspace, or fetch it, and return its default API key (`PUT`).
   *
   * **Contains a credential: do not log it.** Store the `api_key` from the latest call; it is
   * normally the same on every call, but a new one can be issued. Idempotent: calling again
   * is how the key is read again. Retried on 408, 429, 5xx and timeouts, like a GET.
   */
  create(id: string, params: PartnerWorkspaceProvisionRequest = {}, opts?: RequestOptions): Promise<WithMeta<PartnerWorkspaceProvisioned>> {
    return this.t.json({ method: "PUT", path: `/v1/partner/workspaces/${enc(id)}`, body: definedBody(params) }, opts);
  }

  /** Read one user's workspace, without its key. */
  get(id: string, opts?: RequestOptions): Promise<WithMeta<PartnerWorkspaceDetail>> {
    return this.t.json({ method: "GET", path: `/v1/partner/workspaces/${enc(id)}` }, opts);
  }

  /** Set or clear the user's display name (`null` clears it). `PATCH`, so it is not retried after a 5xx or timeout. */
  update(id: string, body: PartnerWorkspaceUpdate, opts?: RequestOptions): Promise<WithMeta<PartnerWorkspace>> {
    return this.t.json({ method: "PATCH", path: `/v1/partner/workspaces/${enc(id)}`, body }, opts);
  }

  /** Suspend the user's workspace: its key is refused on requests. Safe to repeat. */
  suspend(id: string, opts?: RequestOptions): Promise<WithMeta<PartnerWorkspace>> {
    return this.t.json({ method: "POST", path: `/v1/partner/workspaces/${enc(id)}/suspend` }, opts);
  }

  /** Lift a suspension you made. Safe to repeat. */
  reactivate(id: string, opts?: RequestOptions): Promise<WithMeta<PartnerWorkspace>> {
    return this.t.json({ method: "POST", path: `/v1/partner/workspaces/${enc(id)}/reactivate` }, opts);
  }

  /** Move the user to a tier, by its id or name. Takes effect within about 60 seconds. */
  setTier(id: string, tier: string, opts?: RequestOptions): Promise<WithMeta<PartnerWorkspace>> {
    return this.t.json({ method: "PUT", path: `/v1/partner/workspaces/${enc(id)}/tier`, body: { tier } }, opts);
  }

  /**
   * Give the user credits from your balance. Returns `applied: false` when the idempotency key
   * was used before. The returned `idempotency_key` is the one sent (generated when you did
   * not pass one): keep it, and pass it back to retry this assignment later.
   *
   * The SDK's own retries reuse the same key, and the server treats a repeat as a no-op, so a
   * retried request cannot move credits twice. This POST is retried like an idempotent call.
   */
  async giveCredits(id: string, params: GiveCreditsParams, opts?: RequestOptions): Promise<WithMeta<PartnerCreditAssigned & { idempotency_key: string }>> {
    const key = params.idempotency_key ?? newIdempotencyKey();
    const r = await this.t.json<PartnerCreditAssigned>(
      {
        method: "POST",
        path: `/v1/partner/workspaces/${enc(id)}/credits`,
        body: { credits: params.credits, idempotency_key: key },
        idempotent: true,
      },
      opts,
    );
    return withMeta({ ...r, idempotency_key: key }, r._meta);
  }

  /** One user's usage, one row per day. */
  usage(id: string, params: PartnerWorkspaceUsageParams = {}, opts?: RequestOptions): Promise<WithMeta<PartnerWorkspaceUsage>> {
    return this.t.json({ method: "GET", path: `/v1/partner/workspaces/${enc(id)}/usage`, query: params }, opts);
  }
}

/** The partner's tiers: `/v1/partner/tiers`. */
export class PartnerTiers {
  constructor(private readonly t: Transport) {}

  /** List the tiers, the default first. `workspaces` counts the live users on each. */
  list(opts?: RequestOptions): Promise<WithMeta<PartnerTierList>> {
    return this.t.json({ method: "GET", path: "/v1/partner/tiers" }, opts);
  }

  /** Create a tier. The first tier you create becomes the default. */
  create(body: PartnerTierInput, opts?: RequestOptions): Promise<WithMeta<PartnerTier>> {
    return this.t.json({ method: "POST", path: "/v1/partner/tiers", body }, opts);
  }

  /** Change the fields you send. Pass `{ default: true }` to make this tier the default. */
  update(tierId: string, body: PartnerTierPatch, opts?: RequestOptions): Promise<WithMeta<PartnerTier>> {
    return this.t.json({ method: "PATCH", path: `/v1/partner/tiers/${enc(tierId)}`, body }, opts);
  }

  /** Delete a tier. Refused (409) while users are on it or while it is the default. */
  async delete(tierId: string, opts?: RequestOptions): Promise<{ readonly _meta: ResponseMeta }> {
    const r = await this.t.request({ method: "DELETE", path: `/v1/partner/tiers/${enc(tierId)}`, parse: "none" }, opts);
    return withMeta({}, r.meta);
  }
}
