import type { RequestOptions, Transport } from "../core.js";
import { withMeta } from "../core.js";
import { PagePromise } from "../pagination.js";
import type {
  Monitor,
  MonitorChangeList,
  MonitorChangesParams,
  MonitorCheckResult,
  MonitorCreate,
  MonitorList,
  MonitorPage,
  MonitorPageList,
  MonitorPagesParams,
  MonitorUpdate,
  ResponseMeta,
  WithMeta,
} from "../types.js";

const enc = encodeURIComponent;

/**
 * Page and site monitors: `/v1/monitors`. A monitor re-fetches a URL (or, with `scope: "site"`,
 * a whole site) on an interval and reports what changed, to its webhook endpoint if it has one.
 */
export class Monitors {
  constructor(private readonly t: Transport) {}

  /** Create a monitor. `url` and `webhook_endpoint_id` are required; `scope` defaults to `"page"`. */
  create(body: MonitorCreate, opts?: RequestOptions): Promise<WithMeta<Monitor>> {
    return this.t.json({ method: "POST", path: "/v1/monitors", body }, opts);
  }

  /** List your monitors. */
  list(opts?: RequestOptions): Promise<WithMeta<MonitorList>> {
    return this.t.json({ method: "GET", path: "/v1/monitors" }, opts);
  }

  /** Read one monitor, with its last run. */
  get(id: string, opts?: RequestOptions): Promise<WithMeta<Monitor>> {
    return this.t.json({ method: "GET", path: `/v1/monitors/${enc(id)}` }, opts);
  }

  /** Change the fields you send (`PATCH`). */
  update(id: string, body: MonitorUpdate, opts?: RequestOptions): Promise<WithMeta<Monitor>> {
    return this.t.json({ method: "PATCH", path: `/v1/monitors/${enc(id)}`, body }, opts);
  }

  /** Stop the checks and delete the monitor and its change history. */
  async delete(id: string, opts?: RequestOptions): Promise<{ readonly _meta: ResponseMeta }> {
    const r = await this.t.request({ method: "DELETE", path: `/v1/monitors/${enc(id)}`, parse: "none" }, opts);
    return withMeta({}, r.meta);
  }

  /** Run one check now, fetching the page fresh. A changed page queues `monitor.changed`, as a scheduled check does. */
  check(id: string, opts?: RequestOptions): Promise<WithMeta<MonitorCheckResult>> {
    return this.t.json({ method: "POST", path: `/v1/monitors/${enc(id)}/check` }, opts);
  }

  /** Confirmed changes, newest first, each with its diff. The baseline is not listed. `limit` is 1 to 100 (default 20). */
  changes(id: string, params: MonitorChangesParams = {}, opts?: RequestOptions): Promise<WithMeta<MonitorChangeList>> {
    return this.t.json({ method: "GET", path: `/v1/monitors/${enc(id)}/changes`, query: params }, opts);
  }

  /**
   * The pages a site monitor tracks (a page monitor answers 404). Await for one page, or `for await`
   * for every page: pages follow `next_cursor`. A page that vanished stays listed with `removed_at`.
   */
  pages(id: string, params: MonitorPagesParams = {}, opts?: RequestOptions): PagePromise<MonitorPage, MonitorPageList, MonitorPagesParams> {
    return new PagePromise(async (p: MonitorPagesParams) => {
      const body = await this.t.json<MonitorPageList>({ method: "GET", path: `/v1/monitors/${enc(id)}/pages`, query: p }, opts);
      const next = body.next_cursor ? { ...p, cursor: body.next_cursor } : null;
      return { items: body.data ?? [], body, meta: body._meta, next };
    }, params);
  }
}
