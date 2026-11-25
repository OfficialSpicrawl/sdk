import type { RequestOptions, Transport } from "../core.js";
import type { BrandRequest, BrandResponse, WithMeta } from "../types.js";

/** Options for `brand.get()`: which sections to return, and whether to render a full-browser screenshot. */
export type BrandOptions = Omit<BrandRequest, "url">;

/** A site's brand assets: `POST /v1/brand`. */
export class Brand {
  constructor(private readonly t: Transport) {}

  /**
   * Extract a site's brand assets (identity, logos, icons, colors, fonts, images, videos, socials)
   * from one rendered page load. Links only: nothing is downloaded. Billed like a JavaScript-rendered
   * scrape (`X-Credits-Charged`), and each call bills again, so it is not retried after a failure
   * that may have done the work.
   */
  get(url: string, params: BrandOptions = {}, opts?: RequestOptions): Promise<WithMeta<BrandResponse>> {
    return this.t.json({ method: "POST", path: "/v1/brand", body: { url, ...params } }, opts);
  }
}
