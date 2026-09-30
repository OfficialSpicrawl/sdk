import type { RequestOptions, Transport } from "../core.js";
import type {
  UsageBreakdown,
  UsageByKey,
  UsageParams,
  UsageReconciliation,
  UsageReconciliationParams,
  UsageSummary,
  WithMeta,
} from "../types.js";

/** Usage and credit reporting (`/v1/usage`). */
export class Usage {
  constructor(private readonly t: Transport) {}

  /** Usage over a window. `group_by: "key"` returns a UsageByKey, anything else a UsageBreakdown. */
  get(params: UsageParams = {}, opts?: RequestOptions): Promise<WithMeta<UsageBreakdown | UsageByKey>> {
    return this.t.json({ method: "GET", path: "/v1/usage", query: params }, opts);
  }

  /** Plan, credits and current-period totals. */
  summary(opts?: RequestOptions): Promise<WithMeta<UsageSummary>> {
    return this.t.json({ method: "GET", path: "/v1/usage/summary" }, opts);
  }

  /** Billing reconciliation for one day. */
  reconciliation(params: UsageReconciliationParams = {}, opts?: RequestOptions): Promise<WithMeta<UsageReconciliation>> {
    return this.t.json({ method: "GET", path: "/v1/usage/reconciliation", query: params }, opts);
  }
}
