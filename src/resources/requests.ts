import type { RequestOptions, Transport } from "../core.js";
import { PagePromise } from "../pagination.js";
import type { RequestListParams, RequestLogEntry, RequestLogPage, WithMeta } from "../types.js";

/**
 * Request history (`/v1/requests`). The key's own project needs no scope beyond a
 * valid key; `all_projects: "true"` (every project in the organization) and another
 * project's request by id need the `read` scope.
 */
export class Requests {
  constructor(private readonly t: Transport) {}

  /**
   * List request-log entries newest first, keyset-paginated (`before` + `before_id`).
   * Await for one page or `for await` for every entry in the retention window.
   * Pass `all_projects: "true"` for every project in the organization (`read` scope);
   * it is kept on every following page. Each entry carries `project_id`.
   */
  list(params: RequestListParams = {}, opts?: RequestOptions): PagePromise<RequestLogEntry, RequestLogPage, RequestListParams> {
    return new PagePromise(async (p: RequestListParams) => {
      const body = await this.t.json<RequestLogPage>({ method: "GET", path: "/v1/requests", query: p }, opts);
      const pg = body.page;
      const next =
        pg?.has_more && pg.next_before && pg.next_before_id
          ? { ...p, before: pg.next_before, before_id: pg.next_before_id }
          : null;
      return { items: body.data ?? [], body, meta: body._meta, next };
    }, params);
  }

  /** One request's full trace, by the id from `_meta.requestId` or an error's `requestId`. */
  get(id: string, opts?: RequestOptions): Promise<WithMeta<RequestLogEntry>> {
    return this.t.json({ method: "GET", path: `/v1/requests/${encodeURIComponent(id)}` }, opts);
  }
}
