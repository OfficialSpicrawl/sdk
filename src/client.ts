import { Transport, type ClientOptions, type RequestOptions } from "./core.js";
import { Batch } from "./resources/batch.js";
import { Browser } from "./resources/browser.js";
import { Requests } from "./resources/requests.js";
import { Sessions } from "./resources/sessions.js";
import { Usage } from "./resources/usage.js";
import type { ResponseFormat, ResponseMeta, ScrapeEnvelope, ScrapeRequest, WithMeta } from "./types.js";

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

  constructor(options: ClientOptions = {}) {
    this._transport = new Transport(options);
    this.batch = new Batch(this._transport);
    this.sessions = new Sessions(this._transport);
    this.requests = new Requests(this._transport);
    this.usage = new Usage(this._transport);
    this.browser = new Browser(this._transport);
  }

  get baseURL(): string {
    return this._transport.baseURL;
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
