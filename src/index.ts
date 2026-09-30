export { Spicrawl, type ScrapeParams, type ScrapeRawResult } from "./client.js";
export {
  USER_AGENT,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  type ClientOptions,
  type RequestOptions,
  type FetchLike,
} from "./core.js";
export {
  SpicrawlError,
  BadRequestError,
  AuthenticationError,
  InsufficientCreditsError,
  PermissionDeniedError,
  NotFoundError,
  ConflictError,
  GoneError,
  RateLimitError,
  InternalServerError,
  APIConnectionError,
  APITimeoutError,
  isSpicrawlError,
} from "./errors.js";
export { Page, PagePromise } from "./pagination.js";
export {
  TERMINAL_BATCH_STATUSES,
  type BatchResultsPage,
  type WaitForCompletionOptions,
} from "./resources/batch.js";
export type { Batch } from "./resources/batch.js";
export type { Sessions } from "./resources/sessions.js";
export type { Requests } from "./resources/requests.js";
export type { Usage } from "./resources/usage.js";
export type { Browser } from "./resources/browser.js";
export { ERROR_CODES } from "./types.js";
export type * from "./types.js";
export type { components, operations, paths } from "./generated/openapi.js";
export { VERSION } from "./version.js";
