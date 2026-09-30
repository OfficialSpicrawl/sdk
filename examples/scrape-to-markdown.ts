// Convert a web page to Markdown for an LLM.
// Run: SPICRAWL_API_KEY=spicrawl_live_... npx tsx examples/scrape-to-markdown.ts https://example.com
import { Spicrawl } from "@spicrawl/sdk";

const spicrawl = new Spicrawl();
const url = process.argv[2] ?? "https://example.com";

const page = await spicrawl.scrapeRaw({ url, response_format: "markdown", main_content_only: true });
if (page.format === "markdown") console.log(page.body);
console.error(`target status ${page.targetStatus}, ${page._meta.creditsCharged ?? 0} credits, engine ${page._meta.engine}`);
