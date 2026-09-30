import type { ErrorCode, Problem, ProblemDiagnostics } from "./types.js";

/** Base class of every error this SDK throws. */
export class SpicrawlError extends Error {
  /** The platform's HTTP status; 0 when no response was received. */
  readonly status: number;
  /** Stable machine code, `ERR::FAMILY::NAME`. Switch on this. */
  readonly code: ErrorCode;
  readonly title?: string;
  readonly detail?: string;
  /** The server's own verdict on whether the same request can succeed on retry. */
  readonly retryable: boolean;
  readonly docUrl?: string;
  readonly requestId?: string;
  /** From `Retry-After` or `retry_after_seconds`. */
  readonly retryAfterSeconds?: number;
  readonly diagnostics?: ProblemDiagnostics;
  /** The target site's status when the failure came from the site. */
  readonly targetStatus?: number | null;
  /** Non-fatal decisions reported alongside the error. */
  readonly warnings?: string[];
  /** The raw problem body (or a synthesized one for non-problem failures). */
  readonly problem?: Partial<Problem> & Record<string, unknown>;
  /** Response headers, when a response was received. */
  readonly headers?: Headers;

  constructor(
    message: string,
    init: {
      status?: number;
      code?: ErrorCode;
      retryable?: boolean;
      problem?: Partial<Problem> & Record<string, unknown>;
      headers?: Headers;
      retryAfterSeconds?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = new.target.name;
    const p = init.problem ?? {};
    this.status = init.status ?? (typeof p.status === "number" ? p.status : 0);
    this.code = init.code ?? (typeof p.code === "string" ? p.code : `HTTP_${this.status}`);
    this.title = p.title;
    this.detail = p.detail;
    this.retryable = typeof p.retryable === "boolean" ? p.retryable : (init.retryable ?? false);
    this.docUrl = p.doc_url;
    this.requestId = p.request_id ?? init.headers?.get("x-request-id") ?? undefined;
    this.retryAfterSeconds = init.retryAfterSeconds ?? p.retry_after_seconds;
    this.diagnostics = p.diagnostics;
    this.targetStatus = p.target_status;
    this.warnings = p.warnings;
    this.problem = init.problem;
    this.headers = init.headers;
  }
}

/** 400 and any status without a dedicated subclass. */
export class BadRequestError extends SpicrawlError {}
/** 401: missing, invalid, revoked or expired API key. */
export class AuthenticationError extends SpicrawlError {}
/** 402: the credit quota is exhausted. */
export class InsufficientCreditsError extends SpicrawlError {}
/** 403: forbidden, missing scope, or engine not entitled. */
export class PermissionDeniedError extends SpicrawlError {}
/** 404. */
export class NotFoundError extends SpicrawlError {}
/** 409: e.g. a busy session or a job already terminal. */
export class ConflictError extends SpicrawlError {}
/** 410: beyond retention, or a released/expired session. */
export class GoneError extends SpicrawlError {}
/** 429: rate, concurrency or live-session limit. Honour `retryAfterSeconds`. */
export class RateLimitError extends SpicrawlError {}
/** 5xx. */
export class InternalServerError extends SpicrawlError {}
/** The request never produced a response (DNS, refused connection, reset...). */
export class APIConnectionError extends SpicrawlError {
  constructor(message: string, opts: { cause?: unknown; retryable?: boolean } = {}) {
    super(message, { code: "CONNECTION_ERROR", retryable: opts.retryable ?? true, cause: opts.cause });
  }
}
/** The request exceeded `timeoutMs`. For POSTs the server may still have performed (and billed) it. */
export class APITimeoutError extends APIConnectionError {
  constructor(message: string) {
    super(message, { retryable: false });
    (this as { code: ErrorCode }).code = "TIMEOUT";
  }
}

export function isSpicrawlError(err: unknown): err is SpicrawlError {
  return err instanceof SpicrawlError;
}

/** Build the right subclass for an HTTP error response. */
export function errorFromResponse(
  status: number,
  body: unknown,
  headers: Headers,
  retryAfterSeconds: number | undefined,
): SpicrawlError {
  const isObj = typeof body === "object" && body !== null;
  const problem = (isObj ? body : { detail: typeof body === "string" ? body.slice(0, 500) : undefined }) as Partial<Problem> &
    Record<string, unknown>;
  const message = problem.detail || problem.title || `Request failed with HTTP ${status}`;
  const init = {
    status,
    problem,
    headers,
    retryAfterSeconds,
    retryable: status === 408 || status === 429 || status >= 500,
  };
  const Cls =
    status === 401
      ? AuthenticationError
      : status === 402
        ? InsufficientCreditsError
        : status === 403
          ? PermissionDeniedError
          : status === 404
            ? NotFoundError
            : status === 409
              ? ConflictError
              : status === 410
                ? GoneError
                : status === 429
                  ? RateLimitError
                  : status >= 500
                    ? InternalServerError
                    : BadRequestError;
  const codeSuffix = typeof problem.code === "string" ? ` [${problem.code}]` : "";
  return new Cls(`${message}${codeSuffix}`, init);
}
