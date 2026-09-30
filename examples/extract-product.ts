// Render a JavaScript page and extract structured fields with CSS selectors.
// Run: SPICRAWL_API_KEY=spicrawl_live_... npx tsx examples/extract-product.ts
import { Spicrawl, isSpicrawlError } from "@spicrawl/sdk";

const spicrawl = new Spicrawl();

try {
  const result = await spicrawl.scrape({
    url: "https://example.com",
    js_render: true,
    extract: { title: "h1", description: "p" },
  });
  console.log("target status:", result.status);
  console.log(result.data);
  if (result.empty_fields?.length) console.warn("selectors that matched nothing:", result.empty_fields);
} catch (err) {
  if (isSpicrawlError(err)) {
    console.error(`${err.code}: ${err.message}`);
    if (err.diagnostics?.hint) console.error("hint:", err.diagnostics.hint);
    process.exit(1);
  }
  throw err;
}
