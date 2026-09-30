import {
  APIConnectionError,
  APITimeoutError,
  SpicrawlError,
  errorFromResponse,
} from "./errors.js";
import type { ResponseMeta, WithMeta } from "./types.js";
import { VERSION } from "./version.js";

export const USER_AGENT = `spicrawl-sdk-js/${VERSION}`;
export const DEFAULT_BASE_URL = "https://api.spicrawl.com";
export const DEFAULT_TIMEOUT_MS = 180_000;
export const DEFAULT_MAX_RETRIES = 2;
/** Never sleep longer than this for a Retry-After; a longer wait is surfaced as the error instead. */
const MAX_RETRY_AFTER_SECONDS = 60;

/** Options accepted by every method, as the last argument. */
export interface RequestOptions {
  /** Abort the request (and any pending retry sleep). */
  signal?: AbortSignal;
  /** Per-attempt timeout, overriding the client's `timeoutMs`. */
  timeoutMs?: number;
  /** Extra headers for this request only. */
  headers?: Record<string, string>;
  /** Override the client's `maxRetries` for this request. */
  maxRetries?: number;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ClientOptions {
  /** Defaults to `process.env.SPICRAWL_API_KEY`. */
  apiKey?: string;
  /** Defaults to `process.env.SPICRAWL_BASE_URL`, else https://api.spicrawl.com. */
  baseURL?: string;
  /** Per-attempt timeout in ms. Default 180000 (renders can be slow). */
  timeoutMs?: number;
  /** Retries after the first attempt. Default 2. See README "Retries". */
  maxRetries?: number;
  /** Custom fetch (e.g. undici with a proxy agent, or a mock in tests). */
  fetch?: FetchLike;
  /** Headers sent with every request. */
  defaultHeaders?: Record<string, string>;
}

export type QueryValue = string | number | boolean | readonly (string | number)[] | null | undefined;

export interface CallSpec {
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, QueryValue> | object;
  body?: unknown;
  /** How to read a successful body. */
  parse?: "json" | "text" | "arraybuffer" | "none" | "auto";
  accept?: string;
}

export interface RawResult {
  response: Response;
  meta: ResponseMeta;
  /** Parsed JSON, text, ArrayBuffer, or undefined, per `parse`. */
  data: unknown;
  contentType: string;
}

/** Network error codes that prove the request never reached the server. */
const NOT_SENT_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_CONNECT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

function causeCodes(err: unknown): string[] {
  const codes: string[] = [];
  const seen = new Set<unknown>();
  const walk = (e: unknown, depth: number) => {
    if (!e || typeof e !== "object" || seen.has(e) || depth > 5) return;
    seen.add(e);
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") codes.push(code);
    walk((e as { cause?: unknown }).cause, depth + 1);
    const errors = (e as { errors?: unknown }).errors;
    if (Array.isArray(errors)) for (const x of errors) walk(x, depth + 1);
  };
  walk(err, 0);
  return codes;
}

/** True when a fetch failure provably happened before any byte of the request was sent. */
export function isDefinitelyNotSent(err: unknown): boolean {
  return causeCodes(err).some((c) => NOT_SENT_CODES.has(c));
}

function num(h: Headers, name: string): number | null {
  const v = h.get(name);
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function readMeta(response: Response): ResponseMeta {
  const h = response.headers;
  const warn = h.get("x-warning");
  const cache = h.get("cache-state");
  return {
    status: response.status,
    requestId: h.get("x-request-id"),
    creditsCharged: num(h, "x-credits-charged"),
    creditsRemaining: num(h, "x-credits-remaining"),
    requestCost: num(h, "x-request-cost"),
    rateLimit: {
      limit: num(h, "x-ratelimit-limit"),
      remaining: num(h, "x-ratelimit-remaining"),
      reset: num(h, "x-ratelimit-reset"),
    },
    engine: h.get("x-engine"),
    cacheState: cache === "hit" || cache === "miss" || cache === "bypass" ? cache : null,
    targetStatus: num(h, "x-target-status"),
    // Repeated headers are joined with ", " by fetch; each value is "CODE: message".
    warnings: warn ? warn.split(/,\s*(?=[A-Z][A-Z_]+:)/).map((s) => s.trim()).filter(Boolean) : [],
    headers: h,
  };
}

/** Attach metadata as a non-enumerable property, so JSON.stringify and spreads ignore it. */
export function withMeta<T>(value: T, meta: ResponseMeta): WithMeta<T> {
  const target = (value !== null && typeof value === "object" ? value : {}) as object;
  Object.defineProperty(target, "_meta", { value: meta, enumerable: false, configurable: true });
  return target as WithMeta<T>;
}

function retryAfterFrom(headers: Headers, body: unknown): number | undefined {
  const h = headers.get("retry-after");
  if (h !== null) {
    const secs = Number(h);
    if (Number.isFinite(secs) && secs >= 0) return secs;
    const date = Date.parse(h);
    if (!Number.isNaN(date)) return Math.max(0, (date - Date.now()) / 1000);
  }
  const b = body as { retry_after_seconds?: unknown } | null;
  if (b && typeof b === "object" && typeof b.retry_after_seconds === "number") return b.retry_after_seconds;
  return undefined;
}

export function encodeQuery(query: object | undefined): string {
  if (!query) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    const s = Array.isArray(v) ? v.join(",") : String(v);
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(s)}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Exponential backoff with jitter: ~0.5s, 1s, 2s ... capped at 8s. */
function backoffMs(attempt: number): number {
  const base = Math.min(500 * 2 ** attempt, 8000);
  return base * (0.75 + Math.random() * 0.25);
}

/** Internal HTTP engine shared by all resources. */
export class Transport {
  readonly baseURL: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  private readonly fetchImpl: FetchLike;
  private readonly defaultHeaders: Record<string, string>;
  /** Test hook: replaces the retry sleep. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void> = sleep;

  constructor(opts: ClientOptions) {
    const env = typeof process !== "undefined" ? process.env : ({} as Record<string, string | undefined>);
    const apiKey = opts.apiKey ?? env.SPICRAWL_API_KEY;
    if (!apiKey) {
      throw new SpicrawlError(
        "No API key. Pass { apiKey } or set the SPICRAWL_API_KEY environment variable (spicrawl_live_... or spicrawl_test_...).",
        { code: "ERR::AUTH::MISSING_KEY", status: 0 },
      );
    }
    this.apiKey = apiKey;
    this.baseURL = (opts.baseURL ?? env.SPICRAWL_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    const f = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!f) throw new SpicrawlError("No global fetch found; use Node.js >= 18 or pass { fetch }.");
    this.fetchImpl = f;
    this.defaultHeaders = opts.defaultHeaders ?? {};
  }

  url(path: string, query?: object): string {
    return `${this.baseURL}${path}${encodeQuery(query)}`;
  }

  /** JSON call that returns the parsed body with `_meta` attached. */
  async json<T>(spec: CallSpec, opts?: RequestOptions): Promise<WithMeta<T>> {
    const r = await this.request({ parse: "json", ...spec }, opts);
    return withMeta(r.data as T, r.meta);
  }

  async request(spec: CallSpec, opts: RequestOptions = {}): Promise<RawResult> {
    const maxRetries = opts.maxRetries ?? this.maxRetries;
    const idempotent = spec.method !== "POST";
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.attempt(spec, opts);
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        const delay = this.retryDelay(err, idempotent, attempt, maxRetries);
        if (delay === null) throw err;
        await this.sleep(delay, opts.signal);
      }
    }
  }

  /**
   * The retry policy. There are no idempotency keys server-side, so a retried POST can
   * perform and bill the work twice: POSTs retry only when the server provably did no work.
   */
  private retryDelay(err: unknown, idempotent: boolean, attempt: number, max: number): number | null {
    if (attempt >= max || !(err instanceof SpicrawlError)) return null;
    if (err instanceof APITimeoutError) return idempotent ? backoffMs(attempt) : null;
    if (err instanceof APIConnectionError) {
      return idempotent || isDefinitelyNotSent(err.cause) ? backoffMs(attempt) : null;
    }
    const s = err.status;
    const retriableStatus = idempotent ? s === 408 || s === 429 || s >= 500 : s === 429;
    // A 429 is rejected before any work, so it is safe for POST even when the problem omits
    // `retryable`; an explicit `retryable: false` from the server still wins.
    if (!retriableStatus) return null;
    if (err.problem && err.problem.retryable === false) return null;
    if (err.retryAfterSeconds !== undefined) {
      if (err.retryAfterSeconds > MAX_RETRY_AFTER_SECONDS) return null;
      return err.retryAfterSeconds * 1000;
    }
    return backoffMs(attempt);
  }

  private async attempt(spec: CallSpec, opts: RequestOptions): Promise<RawResult> {
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const isTimedOut = () => timedOut;
    const onAbort = () => controller.abort(opts.signal?.reason);
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort(opts.signal.reason);
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: spec.accept ?? "application/json",
      "User-Agent": USER_AGENT,
      ...this.defaultHeaders,
      ...opts.headers,
    };
    if (spec.body !== undefined) headers["Content-Type"] = "application/json";

    const url = this.url(spec.path, spec.query);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: spec.method,
          headers,
          body: spec.body !== undefined ? JSON.stringify(spec.body) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        if (timedOut) {
          throw new APITimeoutError(
            `${spec.method} ${spec.path} timed out after ${timeoutMs} ms` +
              (spec.method === "POST" ? " (the server may still have performed and billed the request)" : ""),
          );
        }
        throw new APIConnectionError(
          `Could not reach the Spicrawl API at ${this.baseURL}: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      const contentType = response.headers.get("content-type") ?? "";
      const meta = readMeta(response);
      const isJSON = /json/i.test(contentType) && !/ndjson/i.test(contentType);

      // A non-2xx is an error only when the body is a platform problem, or the response
      // is not a completed scrape (no X-Engine). A scrape with `original_status` relays the
      // target's own status on a SUCCESSFUL call; that content must reach the caller.
      if (!response.ok) {
        const text = await readText(response, isTimedOut, timeoutMs, spec);
        let body: unknown = text;
        try {
          body = text ? JSON.parse(text) : {};
        } catch {
          /* not JSON: a gateway page */
        }
        const isProblem = typeof body === "object" && body !== null && typeof (body as { code?: unknown }).code === "string";
        if (isProblem || !response.headers.has("x-engine")) {
          throw errorFromResponse(response.status, body, response.headers, retryAfterFrom(response.headers, body));
        }
        return { response, meta, contentType, data: parseRelayed(text, isJSON, spec.parse) };
      }

      let data: unknown;
      const parse = spec.parse ?? "json";
      if (parse === "none") {
        data = undefined;
        await response.body?.cancel().catch(() => undefined);
      } else if (parse === "arraybuffer" || (parse === "auto" && /application\/pdf/i.test(contentType))) {
        data = await guard(response.arrayBuffer(), isTimedOut, timeoutMs, spec);
      } else {
        const text = await readText(response, isTimedOut, timeoutMs, spec);
        if (parse === "text" || (parse === "auto" && !isJSON)) data = text;
        else {
          try {
            data = text ? JSON.parse(text) : undefined;
          } catch (err) {
            throw new SpicrawlError(`Expected JSON from ${spec.method} ${spec.path}, got ${contentType || "no content type"}`, {
              status: response.status,
              headers: response.headers,
              cause: err,
            });
          }
        }
      }
      return { response, meta, contentType, data };
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }
}

function parseRelayed(text: string, isJSON: boolean, parse: CallSpec["parse"]): unknown {
  if (parse === "text" || (!isJSON && parse === "auto")) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function guard<T>(p: Promise<T>, timedOut: () => boolean, timeoutMs: number, spec: CallSpec): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if ((err as Error)?.name === "AbortError" || timedOut()) {
      if (!timedOut()) throw err;
      throw new APITimeoutError(`${spec.method} ${spec.path} timed out after ${timeoutMs} ms while reading the body`);
    }
    throw new APIConnectionError(`Connection lost while reading ${spec.path}`, { cause: err, retryable: spec.method !== "POST" });
  }
}

function readText(response: Response, timedOut: () => boolean, timeoutMs: number, spec: CallSpec): Promise<string> {
  return guard(response.text(), timedOut, timeoutMs, spec);
}
