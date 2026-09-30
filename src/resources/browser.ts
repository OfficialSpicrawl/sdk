import type { RequestOptions, Transport } from "../core.js";
import { encodeQuery } from "../core.js";
import type { BrowserConnectParams, BrowserToken, BrowserTokenRequest, WithMeta } from "../types.js";

/**
 * Remote browser over CDP (`/v1/browser`). **Coming soon** — not available during the beta.
 */
export class Browser {
  constructor(private readonly t: Transport) {}

  /**
   * **Coming soon.** Mint a single-use, 60-second connect URL that carries a token instead of
   * your API key, for CDP clients that accept only a URL.
   */
  token(body: BrowserTokenRequest = {}, opts?: RequestOptions): Promise<WithMeta<BrowserToken>> {
    return this.t.json({ method: "POST", path: "/v1/browser/token", body }, opts);
  }

  /**
   * **Coming soon.** Build a `wss://…/v1/browser` URL for `puppeteer.connect({ browserWSEndpoint })`
   * or `chromium.connectOverCDP()`. Pass `{ token }` from `token()`. URLs end up in logs, so the
   * API key is only embedded (as `apikey`) when you opt in with `{ includeApiKey: true }`.
   */
  connectURL(params: Omit<BrowserConnectParams, "apikey" | "api_key"> & { includeApiKey?: boolean } = {}): string {
    const { includeApiKey, ...rest } = params;
    const query: Record<string, unknown> = { ...rest };
    if (!rest.token && includeApiKey === true) query.apikey = this.t.apiKey;
    const base = this.t.baseURL.replace(/^http(s?):\/\//, (_m, s: string) => `ws${s}://`);
    return `${base}/v1/browser${encodeQuery(query)}`;
  }
}
