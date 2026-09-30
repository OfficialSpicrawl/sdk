import { APITimeoutError } from "../errors.js";
import type { RequestOptions, Transport } from "../core.js";
import { PagePromise } from "../pagination.js";
import type {
  BatchAppendRequest,
  BatchAppendResponse,
  BatchCreateRequest,
  BatchJob,
  BatchJobList,
  BatchJobStatus,
  BatchListParams,
  BatchResultLine,
  BatchResultsParams,
  BatchRetryResponse,
  ResponseMeta,
  WithMeta,
} from "../types.js";

export const TERMINAL_BATCH_STATUSES: readonly BatchJobStatus[] = ["completed", "failed", "cancelled"];

export interface BatchResultsPage {
  lines: BatchResultLine[];
  /** From `X-Next-Cursor`; undefined means no more finished items right now. */
  nextCursor?: string;
  _meta: ResponseMeta;
}

export interface WaitForCompletionOptions {
  /** Delay between polls. Default 3000 ms. */
  pollIntervalMs?: number;
  /** Give up after this long (throws APITimeoutError). Default: wait forever. */
  timeoutMs?: number;
  /** Called with the job after every poll. */
  onProgress?: (job: WithMeta<BatchJob>) => void;
  signal?: AbortSignal;
}

const enc = encodeURIComponent;

/** Parse newline-delimited JSON, ignoring blank lines. */
export function parseNDJSON<T>(text: string): T[] {
  const out: T[] = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s) as T);
    } catch {
      throw new SyntaxError(`batch results: malformed NDJSON line (${s.length} bytes): ${s.slice(0, 80)}`);
    }
  }
  return out;
}

/** Asynchronous batch jobs: `/v1/batch`. */
export class Batch {
  constructor(private readonly t: Transport) {}

  /**
   * Submit a job (`POST /v1/batch`). Not idempotent: resubmitting creates and bills a second job,
   * so this call is never retried after it may have reached the server.
   */
  create(body: BatchCreateRequest, opts?: RequestOptions): Promise<WithMeta<BatchJob>> {
    return this.t.json({ method: "POST", path: "/v1/batch", body }, opts);
  }

  /** Get a job and its live progress. */
  get(batchId: string, opts?: RequestOptions): Promise<WithMeta<BatchJob>> {
    return this.t.json({ method: "GET", path: `/v1/batch/${enc(batchId)}` }, opts);
  }

  /** List jobs newest first. Await for one page or `for await` for every job. */
  list(params: BatchListParams = {}, opts?: RequestOptions): PagePromise<BatchJob, BatchJobList, BatchListParams> {
    return new PagePromise(async (p: BatchListParams) => {
      const body = await this.t.json<BatchJobList>({ method: "GET", path: "/v1/batch", query: p }, opts);
      return {
        items: body.batches ?? [],
        body,
        meta: body._meta,
        next: body.next_cursor ? { ...p, cursor: body.next_cursor } : null,
      };
    }, params);
  }

  /** Request cancellation; the job moves to `cancelling`, then `cancelled`. */
  cancel(batchId: string, opts?: RequestOptions): Promise<WithMeta<BatchJob>> {
    return this.t.json({ method: "POST", path: `/v1/batch/${enc(batchId)}/cancel` }, opts);
  }

  /** Re-run every failed item. */
  retry(batchId: string, opts?: RequestOptions): Promise<WithMeta<BatchRetryResponse>> {
    return this.t.json({ method: "POST", path: `/v1/batch/${enc(batchId)}/retry` }, opts);
  }

  /** Close an open (streaming) job so it can finish once its items are done. */
  close(batchId: string, opts?: RequestOptions): Promise<WithMeta<BatchJob>> {
    return this.t.json({ method: "POST", path: `/v1/batch/${enc(batchId)}/close` }, opts);
  }

  /** Append items to an open job. Not idempotent: do not re-append after a network error. */
  append(batchId: string, body: BatchAppendRequest, opts?: RequestOptions): Promise<WithMeta<BatchAppendResponse>> {
    return this.t.json({ method: "POST", path: `/v1/batch/${enc(batchId)}/items`, body }, opts);
  }

  /** Fetch ONE page of finished items (JSON Lines). Prefer `results()` to iterate them all. */
  async resultsPage(batchId: string, params: BatchResultsParams = {}, opts?: RequestOptions): Promise<BatchResultsPage> {
    const r = await this.t.request(
      {
        method: "GET",
        path: `/v1/batch/${enc(batchId)}/results`,
        query: params,
        parse: "text",
        accept: "application/x-ndjson",
      },
      opts,
    );
    const nextCursor = r.response.headers.get("x-next-cursor") ?? undefined;
    return { lines: parseNDJSON<BatchResultLine>(r.data as string), nextCursor, _meta: r.meta };
  }

  /**
   * Iterate every finished item, following `X-Next-Cursor` across pages:
   * `for await (const line of spicrawl.batch.results(id)) ...`
   * On a running job this stops at the last finished item; call again later with
   * `cursor` to continue.
   */
  async *results(batchId: string, params: BatchResultsParams = {}, opts?: RequestOptions): AsyncGenerator<BatchResultLine> {
    let cursor = params.cursor;
    for (;;) {
      const page = await this.resultsPage(batchId, { ...params, cursor }, opts);
      yield* page.lines;
      if (!page.nextCursor || page.nextCursor === cursor) return;
      cursor = page.nextCursor;
    }
  }

  /**
   * One item's payload verbatim (`GET /v1/batch/{id}/tasks/{seq}/content`). The spec leaves the
   * body untyped, so it is returned as parsed JSON (`unknown`). `truncated` reflects
   * `X-Content-Truncated`.
   */
  async taskContent(
    batchId: string,
    seq: number,
    opts?: RequestOptions,
  ): Promise<{ content: unknown; truncated: boolean; _meta: ResponseMeta }> {
    const r = await this.t.request(
      { method: "GET", path: `/v1/batch/${enc(batchId)}/tasks/${enc(String(seq))}/content`, parse: "auto" },
      opts,
    );
    return { content: r.data, truncated: r.response.headers.get("x-content-truncated") === "true", _meta: r.meta };
  }

  /**
   * Poll until the job reaches `completed`, `failed` or `cancelled`, and return it.
   * An `open` job never finishes on its own: call `close()` first.
   */
  async waitForCompletion(batchId: string, options: WaitForCompletionOptions = {}): Promise<WithMeta<BatchJob>> {
    const interval = options.pollIntervalMs ?? 3000;
    const deadline = options.timeoutMs !== undefined ? Date.now() + options.timeoutMs : Infinity;
    for (;;) {
      const job = await this.get(batchId, { signal: options.signal });
      options.onProgress?.(job);
      if (TERMINAL_BATCH_STATUSES.includes(job.status)) return job;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new APITimeoutError(
          `Batch ${batchId} still ${job.status} after ${options.timeoutMs} ms` + (job.open ? " (the job is open: call batch.close())" : ""),
        );
      }
      await this.t.sleep(Math.min(interval, remaining), options.signal);
    }
  }
}

