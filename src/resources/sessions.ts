import type { RequestOptions, Transport } from "../core.js";
import { withMeta } from "../core.js";
import { PagePromise } from "../pagination.js";
import type {
  ResponseMeta,
  Session,
  SessionContextDump,
  SessionCreateRequest,
  SessionList,
  SessionListParams,
  WithMeta,
} from "../types.js";

const enc = encodeURIComponent;

/** Persistent scrape sessions (cookies + storage): `/v1/sessions`. */
export class Sessions {
  constructor(private readonly t: Transport) {}

  /** Create a session. Pass a previous `session_context` to clone one. */
  create(body: SessionCreateRequest = {}, opts?: RequestOptions): Promise<WithMeta<Session>> {
    return this.t.json({ method: "POST", path: "/v1/sessions", body }, opts);
  }

  get(sessionId: string, opts?: RequestOptions): Promise<WithMeta<Session>> {
    return this.t.json({ method: "GET", path: `/v1/sessions/${enc(sessionId)}` }, opts);
  }

  /** List sessions newest first. Await for one page or `for await` for all of them. */
  list(params: SessionListParams = {}, opts?: RequestOptions): PagePromise<Session, SessionList, SessionListParams> {
    return new PagePromise(async (p: SessionListParams) => {
      const body = await this.t.json<SessionList>({ method: "GET", path: "/v1/sessions", query: p }, opts);
      return {
        items: body.sessions ?? [],
        body,
        meta: body._meta,
        next: body.next_cursor ? { ...p, cursor: body.next_cursor } : null,
      };
    }, params);
  }

  /** Delete a session and purge its context. `force` deletes even while a task holds it. */
  async delete(sessionId: string, params: { force?: boolean } = {}, opts?: RequestOptions): Promise<{ _meta: ResponseMeta }> {
    const r = await this.t.request(
      { method: "DELETE", path: `/v1/sessions/${enc(sessionId)}`, query: params, parse: "none" },
      opts,
    );
    return withMeta({}, r.meta);
  }

  /** Release a session: it stops accepting work and its context is purged. */
  release(sessionId: string, params: { force?: boolean } = {}, opts?: RequestOptions): Promise<WithMeta<Session>> {
    return this.t.json({ method: "POST", path: `/v1/sessions/${enc(sessionId)}/release`, query: params }, opts);
  }

  /** Dump the live cookies and storage. Contains credentials: do not log it. */
  context(sessionId: string, opts?: RequestOptions): Promise<WithMeta<SessionContextDump>> {
    return this.t.json({ method: "GET", path: `/v1/sessions/${enc(sessionId)}/context` }, opts);
  }
}
