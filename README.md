# Spicrawl SDK: Web Scraping API for Node.js & TypeScript

Official TypeScript SDK for Spicrawl, the web scraping API for AI agents and LLMs: scrape any URL to clean Markdown, HTML or JSON, with JavaScript rendering, structured data extraction, screenshots and batch jobs. `@spicrawl/sdk` has full type definitions, ESM and CommonJS builds, and zero dependencies.

[![npm version](https://img.shields.io/npm/v/@spicrawl/sdk.svg)](https://www.npmjs.com/package/@spicrawl/sdk)
[![npm downloads](https://img.shields.io/npm/dm/@spicrawl/sdk.svg)](https://www.npmjs.com/package/@spicrawl/sdk)
[![types](https://img.shields.io/npm/types/@spicrawl/sdk.svg)](https://www.npmjs.com/package/@spicrawl/sdk)
[![license](https://img.shields.io/npm/l/@spicrawl/sdk.svg)](https://www.npmjs.com/package/@spicrawl/sdk)
[![CI](https://github.com/Spicrawl/sdk/actions/workflows/release.yml/badge.svg)](https://github.com/Spicrawl/sdk/actions/workflows/release.yml)
[![GitHub stars](https://img.shields.io/github/stars/Spicrawl/sdk?style=social)](https://github.com/Spicrawl/sdk)
[![docs](https://img.shields.io/badge/docs-docs.spicrawl.com-blue.svg)](https://docs.spicrawl.com)

**[Docs](https://docs.spicrawl.com)** · **[Get an API key](https://app.spicrawl.com/signup)** · **[GitHub](https://github.com/Spicrawl/sdk)** · **[CLI](https://github.com/Spicrawl/cli)** · **[MCP server for AI agents](https://docs.spicrawl.com/agents/mcp)** · **[Changelog](https://github.com/Spicrawl/sdk/blob/main/CHANGELOG.md)**

## What is Spicrawl?

Spicrawl is a web data API: you send it a URL and it returns the page as HTML, Markdown, plain text, PDF or a JSON envelope with extracted fields. It can render JavaScript in a headless browser, extract data with CSS selectors, XPath, a JSON Schema or page metadata, and process lists of up to 10,000 URLs as one batch job. This SDK wraps that HTTP API for Node.js 18+, with ESM and CommonJS builds and TypeScript types generated from the OpenAPI spec.

## Install

```sh
npm install @spicrawl/sdk
# or: pnpm add @spicrawl/sdk / yarn add @spicrawl/sdk / bun add @spicrawl/sdk
```

Requires Node.js 18 or later. [Create an API key](https://app.spicrawl.com/signup) in the Spicrawl dashboard (keys start with `spicrawl_live_` or `spicrawl_test_`) and export it:

```sh
export SPICRAWL_API_KEY=spicrawl_live_...
```

## Quickstart: scrape a website in 30 seconds

```ts
import { Spicrawl } from "@spicrawl/sdk";

const spicrawl = new Spicrawl(); // reads SPICRAWL_API_KEY

const page = await spicrawl.scrape({ url: "https://example.com" });
console.log(page.status);  // the target site's HTTP status, e.g. 200
console.log(page.content); // the page HTML

// The same page as LLM-ready Markdown
const md = await spicrawl.scrapeRaw({ url: "https://example.com", response_format: "markdown" });
if (md.format === "markdown") console.log(md.body);
```

The client class is named `Spicrawl` and talks to Spicrawl's API at `https://api.spicrawl.com`.

## What you can do

- **Scrape any web page** from Node.js with one call, returning HTML, Markdown, plain text, PDF or a JSON envelope.
- **Render JavaScript-heavy sites** (React, Vue, SPAs) in a headless browser, and wait for a CSS selector before capture.
- **Convert HTML to Markdown for LLMs**, RAG and AI agents, with main-content isolation that drops navigation and boilerplate.
- **Extract structured data as JSON** using CSS selectors, XPath, a typed JSON Schema, or page metadata (JSON-LD, OpenGraph). AI extraction from a plain-language prompt is coming soon.
- **Take screenshots** of a full page or a single element, and print pages to PDF.
- **Batch scrape a list of URLs** (up to 10,000 per job) asynchronously, then stream the results as JSON Lines.
- **Collect every link on a page** with `links: true`, to feed your own crawl queue.
- **Keep sessions and cookies** across requests, so you can log in once and reuse the login.
- **Bring your own proxy** (HTTP, HTTPS or SOCKS5) on any request.
- **Track credits, rate limits and request traces** from typed response metadata.
- **Give AI agents web access**: use the SDK as a tool in your own agent, or connect Claude Code, Cursor, Codex and VS Code to Spicrawl's hosted MCP server.

## Contents

- [Scrape a page to Markdown](#scrape-a-page-to-markdown)
- [Render JavaScript](#render-javascript)
- [Extract structured data](#extract-structured-data)
- [Take a screenshot or PDF](#take-a-screenshot-or-pdf)
- [Batch scrape many URLs](#batch-scrape-many-urls)
- [Sessions and cookies](#sessions-and-cookies)
- [Use your own proxy](#use-your-own-proxy)
- [Use with AI agents](#use-with-ai-agents)
- [Beta limitations](#beta-limitations)
- [Pagination](#pagination)
- [Error handling](#error-handling)
- [Retries and billing safety](#retries-and-billing-safety)
- [Timeouts and cancellation](#timeouts-and-cancellation)
- [Response metadata (credits, rate limits)](#response-metadata-credits-rate-limits)
- [Request history and usage](#request-history-and-usage)
- [Client options](#client-options)
- [TypeScript types](#typescript-types)
- [CommonJS](#commonjs)
- [Examples](#examples)
- [FAQ](#faq)
- [Related](#related)

## Scrape a page to Markdown

`scrape()` returns a typed JSON envelope. `scrapeRaw()` returns the document itself, as a union discriminated by `format`. Use it to get LLM-ready Markdown:

```ts
const md = await spicrawl.scrapeRaw({
  url: "https://example.com/blog/post",
  response_format: "markdown",
  main_content_only: true, // strip nav, footer and sidebars
});
if (md.format === "markdown") console.log(md.body); // string
```

| `format` | `body` type | Notes |
|---|---|---|
| `html`, `markdown`, `text` | `string` | |
| `pdf` | `ArrayBuffer` | needs a browser engine (`engine: "chromium"`) |
| `json` | `string`, plus `envelope` | returned when you ask for JSON, or when `extract`, `links`, `screenshot`, `autoparse`, `ai_extract` or `network_capture` is set |

Use `include_tags` and `exclude_tags` (CSS selectors) to keep or drop parts of the page before conversion.

## Render JavaScript

Set `js_render: true` to load the page in a headless browser so client-side JavaScript runs. Add `wait_for` to wait for an element to appear:

```ts
const spa = await spicrawl.scrape({
  url: "https://example.com/app",
  js_render: true,
  wait_for: "#root .loaded",
});
```

Not sure whether a site needs a browser? `mode: "auto"` starts with a plain HTTP fetch and escalates only when needed, billing only the step that worked:

```ts
const auto = await spicrawl.scrape({ url: "https://example.com", mode: "auto" });
console.log(auto._meta.engine); // the engine that produced the page
```

## Extract structured data

### With CSS selectors

```ts
const product = await spicrawl.scrape({
  url: "https://example.com/product/1",
  extract: { title: "h1", price: ".price" },
});
console.log(product.data);         // { title: "...", price: "..." }
console.log(product.empty_fields); // selectors that matched nothing
```

### With a JSON Schema (typed, validated output)

Give each property a `selector`. Values are coerced to the declared types and validated:

```ts
const typed = await spicrawl.scrape({
  url: "https://example.com/product/1",
  extract: {
    type: "object",
    properties: {
      title: { type: "string", selector: "h1" },
      price: { type: "number", selector: ".price" },
    },
    required: ["title"],
  },
});
console.log(typed.data); // { title: "...", price: 19.99 }
```

### From page metadata (JSON-LD, OpenGraph, microdata)

```ts
const meta = await spicrawl.scrape({ url: "https://example.com/article", autoparse: true });
console.log(meta.data);
```

### With AI extraction (coming soon)

AI extraction is not live yet. It will take a plain-language prompt, optionally with a JSON Schema for the output. The SDK already types `ai_extract`, so this code won't change when it launches ([guide](https://docs.spicrawl.com/guides/ai-extraction)):

```ts
const ai = await spicrawl.scrape({
  url: "https://example.com/pricing",
  ai_extract: {
    prompt: "List each plan with its name and monthly price",
    schema: { type: "object", properties: { plans: { type: "array" } } },
  },
});
console.log(ai.data);
```

### Collect every link on a page

```ts
const { links } = await spicrawl.scrape({ url: "https://example.com", links: true });
```

## Take a screenshot or PDF

Screenshots and PDFs need a rasterising browser engine, so pin `engine: "chromium"`. Images come back base64-encoded under `screenshots`:

```ts
import { writeFile } from "node:fs/promises";

const shot = await spicrawl.scrape({
  url: "https://example.com",
  engine: "chromium",
  screenshot: true,
  screenshot_fullpage: true,
});
const img = shot.screenshots?.[0];
if (img) await writeFile("page.png", Buffer.from(img.data, "base64"));

const pdf = await spicrawl.scrapeRaw({ url: "https://example.com", response_format: "pdf", engine: "chromium" });
if (pdf.format === "pdf") await writeFile("page.pdf", Buffer.from(pdf.body));
```

Use `screenshot_selector` to capture one element instead of the full page.

## Batch scrape many URLs

Queue up to 10,000 URLs as one asynchronous job, wait for it, then stream the results:

```ts
const job = await spicrawl.batch.create({
  urls: ["https://example.com/1", "https://example.com/2"],
  js_render: true,
});

await spicrawl.batch.waitForCompletion(job.id, {
  pollIntervalMs: 3000,
  timeoutMs: 30 * 60_000,
  onProgress: (j) => console.log(j.status, j.progress),
});

// Streams JSON Lines across every results page
for await (const line of spicrawl.batch.results(job.id)) {
  if (line.status === "succeeded") console.log(line.url, line.http_status);
  else console.log(line.url, line.error?.code);
}
```

Per-item overrides and your own correlation ids:

```ts
await spicrawl.batch.create({
  items: [
    { url: "https://example.com/a", external_id: "sku-1" },
    { url: "https://example.com/b", js_render: false },
  ],
  js_render: true,
});
```

Other batch calls: `get(id)`, `list({ status })`, `cancel(id)`, `retry(id)` (re-run failed items), `append(id, { items })` and `close(id)` for open jobs, `resultsPage(id, { limit, status })` and `taskContent(id, seq)`.

## Sessions and cookies

A session keeps cookies and web storage across scrapes, so a login carries over to later requests:

```ts
const session = await spicrawl.sessions.create();
await spicrawl.scrape({ url: "https://example.com/account", session_id: session.id, js_render: true });

const ctx = await spicrawl.sessions.context(session.id); // cookies + storage: contains credentials, do not log
await spicrawl.sessions.release(session.id);
await spicrawl.sessions.delete(session.id, { force: true });
```

## Use your own proxy

Pass a proxy URL (`http`, `https`, `socks5` or `socks5h`, credentials in the userinfo). `proxy_verify: true` checks the proxy first so a dead one fails fast:

```ts
await spicrawl.scrape({
  url: "https://example.com",
  proxy: "http://user:pass@proxy.example.net:8080",
  proxy_verify: true,
});
```

## Use with AI agents

**Give your own agent a web tool.** Wrap one SDK call as a tool function; the Markdown it returns is ready for a prompt. This works with any framework that takes a function, such as the Vercel AI SDK, LangChain.js, the OpenAI Agents SDK or Mastra:

```ts
import { Spicrawl } from "@spicrawl/sdk";

const spicrawl = new Spicrawl();

/** Tool: fetch a web page as clean Markdown for the model. */
export async function fetchPage(url: string): Promise<string> {
  const page = await spicrawl.scrapeRaw({ url, response_format: "markdown", main_content_only: true });
  return page.format === "markdown" ? page.body : "";
}
```

**Connect a coding agent without writing code.** Spicrawl runs a hosted MCP server at `https://mcp.spicrawl.com/mcp`. The [Spicrawl CLI](https://github.com/Spicrawl/cli) sets up Claude Code, Cursor, VS Code and Codex with it, plus the Spicrawl agent skill, in one command:

```sh
npx @spicrawl/cli init
```

See the [MCP guide](https://docs.spicrawl.com/agents/mcp), the [agent skill](https://docs.spicrawl.com/agents/skill) and [llms.txt](https://docs.spicrawl.com/llms.txt), the docs index written for agents.

## Beta limitations

Spicrawl is in beta. What that means today:

- **Proxies:** bring your own with `proxy`. Managed proxy pools (`premium_proxy`, `proxy_country`) are coming soon.
- **Remote browser:** the remote CDP browser (`spicrawl.browser.token()` / `connectURL()`) is coming soon. The methods exist so your code won't change when it launches.
- **AI extraction:** `ai_extract` is coming soon. Use `extract` with CSS/XPath selectors or a JSON Schema today.
- **Crawling:** there is no whole-site crawl or sitemap endpoint. Batch-scrape a list of URLs you supply, and collect links from a page with `links: true`.

## Pagination

List methods (`batch.list`, `sessions.list`, `requests.list`) return a page you can `await` or iterate with `for await`, which follows every following page automatically:

```ts
// Every item, across every page
for await (const s of spicrawl.sessions.list({ limit: 100 })) console.log(s.id);

// One page at a time
let page = await spicrawl.requests.list({ limit: 50 });
console.log(page.data.length);
while (page.hasNextPage()) page = await page.getNextPage();
```

## Error handling

A target site answering 404 or 403 is **not** an error: `page.status` holds the site's answer and the call succeeds. The SDK throws only for platform failures, always as a `SpicrawlError` subclass:

| Class | When |
|---|---|
| `BadRequestError` | 400 (and other 4xx without a dedicated class) |
| `AuthenticationError` | 401 |
| `InsufficientCreditsError` | 402 |
| `PermissionDeniedError` | 403 |
| `NotFoundError` | 404 |
| `ConflictError` | 409 |
| `GoneError` | 410 |
| `RateLimitError` | 429 |
| `InternalServerError` | 5xx |
| `APIConnectionError` | no response (DNS, refused, reset) |
| `APITimeoutError` | `timeoutMs` exceeded |

```ts
import { isSpicrawlError, RateLimitError } from "@spicrawl/sdk";

try {
  await spicrawl.scrape({ url: "https://example.com" });
} catch (err) {
  if (err instanceof RateLimitError) console.log("retry in", err.retryAfterSeconds, "s");
  else if (isSpicrawlError(err)) {
    console.log(err.code);              // e.g. "ERR::UPSTREAM::TIMEOUT": switch on this
    console.log(err.retryable);         // the server's own verdict
    console.log(err.diagnostics?.hint); // which parameter to change next
    console.log(err.requestId);         // pass to spicrawl.requests.get()
  }
}
```

`ERROR_CODES` lists every documented code, and the `ErrorCode` type autocompletes them.

## Retries and billing safety

The API has no idempotency keys, so a retried scrape is a second, billed scrape. The SDK therefore retries conservatively: `maxRetries: 2` by default, exponential backoff with jitter, and `Retry-After` honoured up to 60 s.

| | GET / DELETE | POST (scrape, batch create/append, sessions) |
|---|---|---|
| Connection error | retried | retried **only** if the connection never opened |
| Timeout | retried | **never** (the server may still be working) |
| 408 / 5xx | retried unless `retryable: false` | **never** |
| 429 | retried | retried (rejected before any work) |

```ts
const strict = new Spicrawl({ maxRetries: 0 });
await spicrawl.sessions.get("sess_123", { maxRetries: 5 });
```

Failed scrapes cost 0 credits, and cache hits cost 0 credits.

## Timeouts and cancellation

Every method takes a final options argument with `timeoutMs` (per attempt, default 180 s), an `AbortSignal` and extra headers:

```ts
const controller = new AbortController();
await spicrawl.scrape(
  { url: "https://example.com" },
  { timeoutMs: 60_000, signal: controller.signal, headers: { "X-Trace": "abc" } },
);
```

## Response metadata (credits, rate limits)

Every result carries a typed, non-enumerable `_meta` read from the response headers. It stays out of `JSON.stringify` and object spreads.

```ts
const r = await spicrawl.scrape({ url: "https://example.com" });
r._meta.requestId;        // pass to spicrawl.requests.get() for the full trace
r._meta.creditsCharged;   // what this call billed
r._meta.creditsRemaining; // monthly allowance left after it; null if unlimited or unknown
r._meta.engine;           // engine that produced the page
r._meta.cacheState;       // "hit" | "miss" | "bypass"
r._meta.rateLimit;        // { limit, remaining, reset }
r._meta.warnings;         // non-fatal "CODE: message" warnings
```

## Request history and usage

```ts
for await (const entry of spicrawl.requests.list({ only_errors: "true" })) console.log(entry.id);

// Every project in the organization, not just the key's (needs the `read` scope)
for await (const entry of spicrawl.requests.list({ all_projects: "true" })) console.log(entry.project_id, entry.id);

const summary = await spicrawl.usage.summary(); // plan, credits, current-period totals
const byDay = await spicrawl.usage.get({ from: "2026-09-01", to: "2026-09-24", group_by: "day" });
```

## Client options

```ts
const client = new Spicrawl({
  apiKey: "spicrawl_live_...",         // default: process.env.SPICRAWL_API_KEY
  baseURL: "https://api.spicrawl.com", // default: process.env.SPICRAWL_BASE_URL
  timeoutMs: 180_000,                // per attempt
  maxRetries: 2,
  defaultHeaders: { "X-Team": "growth" },
  // fetch: customFetch,             // e.g. undici with an agent, or a mock in tests
});
```

## TypeScript types

Request and response types are generated from the OpenAPI spec and exported by name:

```ts
import type { ScrapeRequest, ScrapeEnvelope, BatchJob, ErrorCode } from "@spicrawl/sdk";
```

## CommonJS

```js
const { Spicrawl } = require("@spicrawl/sdk");
```

## Examples

Runnable scripts in [`examples/`](https://github.com/Spicrawl/sdk/tree/main/examples) (run with `npx tsx`):

- [scrape-to-markdown.ts](https://github.com/Spicrawl/sdk/blob/main/examples/scrape-to-markdown.ts): convert a web page to Markdown for an LLM.
- [extract-product.ts](https://github.com/Spicrawl/sdk/blob/main/examples/extract-product.ts): render a JavaScript page and extract fields with CSS selectors.
- [batch-crawl.ts](https://github.com/Spicrawl/sdk/blob/main/examples/batch-crawl.ts): submit a batch, wait for it, then stream the results.

## FAQ

### How do I scrape a website in Node.js?

Install `@spicrawl/sdk`, set `SPICRAWL_API_KEY`, and call `await new Spicrawl().scrape({ url })`. The result holds the page `content`, the site's `status` and `headers`, and any extracted `data`.

### How do I convert a webpage to Markdown in Node.js?

Call `spicrawl.scrapeRaw({ url, response_format: "markdown" })` and read `body` when `format === "markdown"`. The SDK needs no HTML parser or extra dependency; the conversion happens on Spicrawl's side.

### How do I convert a web page to Markdown for an LLM?

Call `scrapeRaw({ url, response_format: "markdown", main_content_only: true })` and use `body` when `format === "markdown"`. Main-content isolation removes navigation, footers and sidebars so the Markdown is ready for a prompt or a RAG index.

### Does Spicrawl render JavaScript?

Yes. Set `js_render: true` to render the page in a headless browser, and `wait_for` to wait for a selector; or use `mode: "auto"` to escalate from a plain fetch only when needed.

### How do I extract structured JSON from a web page?

Pass `extract` with a map of field names to CSS selectors, or a JSON Schema whose properties carry a `selector` for typed output; or pass `autoparse: true` for JSON-LD and OpenGraph metadata. The result is in `data`. AI extraction from a prompt (`ai_extract`) is coming soon.

### How do I scrape thousands of URLs?

Use `spicrawl.batch.create({ urls })`, then `waitForCompletion()` and `for await (const line of spicrawl.batch.results(id))`. A job accepts up to 10,000 URLs and open jobs can grow with `append()`.

### Is Spicrawl free?

Spicrawl is in beta. See <https://docs.spicrawl.com> for current plans and credit limits; failed scrapes and cache hits cost 0 credits.

### Can I use my own proxy?

Yes. Pass `proxy: "http://user:pass@host:port"` (HTTP, HTTPS or SOCKS5) on any scrape; it adds no proxy credits. Managed proxy pools are coming soon.

### How are retries billed?

Retries never double-bill a scrape by accident. POST requests are retried only on 429 or when the connection never opened, both cases where no work was done. See [Retries and billing safety](#retries-and-billing-safety).

### Does it work in the browser or at the edge?

The SDK is built on the standard `fetch`, `AbortController`, `Headers` and `Response` APIs and is supported on Node.js 18+. Runtimes that provide these APIs can run it, but never ship your API key to a browser: call Spicrawl from your server.

### Is there a Python SDK?

A Python SDK is in progress. Until it ships, you can call the HTTP API directly (see the [docs](https://docs.spicrawl.com)) or use the [`spicrawl` CLI](https://docs.spicrawl.com/cli/overview).

### Is the Spicrawl SDK open source?

Yes. `@spicrawl/sdk` is Apache-2.0 and developed in the open at [github.com/Spicrawl/sdk](https://github.com/Spicrawl/sdk); issues and pull requests are welcome. The Spicrawl API it calls is a hosted service.

### Should I use the SDK, the CLI or the MCP server?

Use the SDK from Node.js or TypeScript code, the [CLI](https://github.com/Spicrawl/cli) from a terminal, shell script or CI job, and the [MCP server](https://docs.spicrawl.com/agents/mcp) when an AI agent should call Spicrawl itself.

### Why didn't my scrape throw when the site returned 404?

The site's status is data, not an error: read it from `status` in the envelope, `targetStatus` in raw mode, or `_meta.targetStatus`. The SDK only throws when the platform itself fails.

## Related

- **Source code:** [github.com/Spicrawl/sdk](https://github.com/Spicrawl/sdk). Report bugs and request features in [issues](https://github.com/Spicrawl/sdk/issues).
- **CLI:** [`@spicrawl/cli`](https://www.npmjs.com/package/@spicrawl/cli) ([GitHub](https://github.com/Spicrawl/cli)) provides the `spicrawl` command for scraping from your terminal, and sets up AI agents with `spicrawl init`. [CLI docs](https://docs.spicrawl.com/cli/overview)
- **MCP server:** give Claude, Cursor and other AI agents web scraping tools. [MCP docs](https://docs.spicrawl.com/agents/mcp)
- **Agent skill:** teach a coding agent the Spicrawl API. [Skill docs](https://docs.spicrawl.com/agents/skill)
- **Documentation:** <https://docs.spicrawl.com>, with [llms.txt](https://docs.spicrawl.com/llms.txt) for AI agents
- **Dashboard and API keys:** <https://app.spicrawl.com>

## License

[Apache-2.0](https://github.com/Spicrawl/sdk/blob/main/LICENSE)
