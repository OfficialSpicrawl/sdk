# Spicrawl TypeScript SDK

The Spicrawl TypeScript SDK (`@spicrawl/sdk`) is the official Node.js client for the Spicrawl web scraping API: it turns any URL into clean Markdown, HTML, JSON, a screenshot or a PDF, with JavaScript rendering, structured data extraction and batch jobs, for developers building AI agents, RAG pipelines and LLM apps.

[![npm version](https://img.shields.io/npm/v/@spicrawl/sdk.svg)](https://www.npmjs.com/package/@spicrawl/sdk)
[![npm downloads](https://img.shields.io/npm/dm/@spicrawl/sdk.svg)](https://www.npmjs.com/package/@spicrawl/sdk)
[![license](https://img.shields.io/npm/l/@spicrawl/sdk.svg)](https://github.com/OfficialSpicrawl/sdk/blob/main/LICENSE)
[![CI](https://github.com/OfficialSpicrawl/sdk/actions/workflows/release.yml/badge.svg)](https://github.com/OfficialSpicrawl/sdk/actions/workflows/release.yml)

**[Docs](https://docs.spicrawl.com)** · **[Get an API key](https://app.spicrawl.com/signup)** · **[CLI](https://github.com/OfficialSpicrawl/cli)** · **[MCP server](https://docs.spicrawl.com/agents/mcp)** · **[Agent plugins](https://github.com/OfficialSpicrawl/agent-plugins)** · **[Changelog](https://github.com/OfficialSpicrawl/sdk/blob/main/CHANGELOG.md)**

## Install

```sh
npm install @spicrawl/sdk
pnpm add @spicrawl/sdk
bun add @spicrawl/sdk
```

Create an API key at [app.spicrawl.com](https://app.spicrawl.com/signup) and export it. Keys start with `spicrawl_live_` (spends credits) or `spicrawl_test_` (never spends live credits).

```sh
export SPICRAWL_API_KEY=spicrawl_live_...
```

## Quickstart: scrape a URL to Markdown

```ts
// quickstart.mjs: run with `node quickstart.mjs`
import { Spicrawl } from "@spicrawl/sdk";

const spicrawl = new Spicrawl(); // reads SPICRAWL_API_KEY

const page = await spicrawl.scrapeRaw({
  url: "https://example.com",
  response_format: "markdown",
  main_content_only: true, // drop nav, footer and sidebars
});

if (page.format === "markdown") console.log(page.body);
console.log(page.targetStatus, page._meta.engine, page._meta.creditsCharged);
```

It prints the page as Markdown, then the target site's status, the engine that ran and the credits charged (a plain `fetch` scrape costs 1 credit):

```text
# Example Domain
…
200 fetch 1
```

## Features

- **5 output formats** from one call: HTML, Markdown, plain text, PDF, or a JSON envelope with extracted `data`.
- **JavaScript rendering** with `js_render: true`, or `mode: "auto"`, which escalates from a plain fetch only when needed and bills only the step that worked.
- **Structured data extraction** with CSS selectors, XPath, a typed JSON Schema, or page metadata (JSON-LD, OpenGraph), at no extra credits.
- **Screenshots and PDFs** of a full page or a single element.
- **Batch jobs of up to 10,000 URLs per call** (100,000 per open job), with results streamed as JSON Lines.
- **Sessions** that keep cookies and storage across scrapes, and **your own proxy** (HTTP, HTTPS, SOCKS5) on any request.
- **Partner accounts:** provision a workspace, API key, shared balance and tiers for each of your own users.
- **Brand assets** (logos, colors, fonts, links) from one rendered page load, **webhooks** with signed deliveries, and **monitors** that watch a page or a whole site for changes.
- **Billing-safe retries:** a POST is retried only when the server provably did no work, so a retry never bills a scrape twice.
- **Zero runtime dependencies**, ESM and CommonJS builds, and types generated from the OpenAPI spec.

## Scrape a web page

Every snippet below runs as an ES module with this setup:

```ts
import { Spicrawl } from "@spicrawl/sdk";
const spicrawl = new Spicrawl();
```

### `scrape()`: the JSON envelope

`scrape(params, options?)` sends `POST /v1/scrape` and returns the typed JSON envelope: `status` (the target site's status), `content`, `headers`, `credits`, `engine`, `warnings`, plus `data`, `links` or `screenshots` when you ask for them.

```ts
const page = await spicrawl.scrape({ url: "https://example.com", js_render: true, wait_for: "h1" });
console.log(page.status, page.engine, page.credits);
console.log(page.content.slice(0, 200));
```

A site answering 404 or 403 is a successful call, not an error. The SDK throws only when Spicrawl itself fails.

### `scrapeRaw()`: the document as served

`scrapeRaw(params, options?)` returns the body itself, discriminated by `format`:

| `format` | `body` | When |
|---|---|---|
| `html`, `markdown`, `text` | `string` | `response_format` is `html` (default), `markdown` or `text` |
| `pdf` | `ArrayBuffer` | `response_format: "pdf"` |
| `json` | `string`, plus a parsed `envelope` | `json`, or any of `extract`, `links`, `screenshot`, `autoparse`, `network_capture` |

```ts
const r = await spicrawl.scrapeRaw({ url: "https://example.com", response_format: "text" });
if (r.format === "text") console.log(r.body);
```

### Send a request body (POST)

Set `method` to `POST`, `PUT`, `PATCH` or `DELETE` and pass a `body`. A JSON object or array is sent as JSON. Plain fetch only: a body is refused with `js_render`, `stealth`, `session_id` and other browser options. The workspace must have request bodies enabled.

An API usually answers JSON, so use `scrapeRaw()` with `response_format: "html"` to get its reply as sent. `scrape()` returns the page as markdown and fails on a non-HTML document with `ERR::EXTRACT::FAILED`.

```ts
const res = await spicrawl.scrapeRaw({
  url: "https://api.example.com/v1/search",
  method: "POST",
  body: { query: "running shoes", limit: 10 },
  custom_headers: { Authorization: "Bearer <token>" },
  response_format: "html",
});
console.log(res.targetStatus, JSON.parse(res.body));
```

See https://docs.spicrawl.com/guides/post-requests.

## Extract structured data from a web page

Map field names to CSS selectors, or send a JSON Schema whose properties carry a `selector` to get typed, validated values:

```ts
const product = await spicrawl.scrape({
  url: "https://example.com",
  extract: {
    type: "object",
    properties: {
      title: { type: "string", selector: "h1" },
      summary: { type: "string", selector: "p" },
    },
    required: ["title"],
  },
});
console.log(product.data, product.empty_fields); // empty_fields: selectors that matched nothing
```

- `extract: { title: "h1", price: ".price" }` is the short selector form.
- `autoparse: true` returns JSON-LD, OpenGraph and microdata.
- `links: true` returns every link on the page in `links`.
- `ai_extract` (extraction from a plain-language prompt) is typed but **coming soon**: the API refuses it today at 0 credits. See the [AI extraction guide](https://docs.spicrawl.com/guides/ai-extraction).

## Take a screenshot or save a page as PDF

Screenshots and PDFs need full-browser rendering. You do not choose it: Spicrawl routes the request there for you (8 credits). Images arrive base64-encoded in `screenshots`:

```ts
import { writeFile } from "node:fs/promises";

const shot = await spicrawl.scrape({
  url: "https://example.com",
  screenshot: true,
  screenshot_fullpage: true, // or screenshot_selector: "#chart"
});
const img = shot.screenshots?.[0];
if (img) await writeFile("page.png", Buffer.from(img.data, "base64"));

const pdf = await spicrawl.scrapeRaw({ url: "https://example.com", response_format: "pdf" });
if (pdf.format === "pdf") await writeFile("page.pdf", Buffer.from(pdf.body));
```

## Batch scrape thousands of URLs

A batch job queues up to 10,000 URLs per call and runs them server-side with retries. Each item is billed only if it succeeds. Batch jobs never use the result cache.

### `batch.create()`, `batch.waitForCompletion()` and `batch.results()`

```ts
const job = await spicrawl.batch.create({
  urls: ["https://example.com", "https://example.org"],
  js_render: true,
});

const done = await spicrawl.batch.waitForCompletion(job.id, {
  pollIntervalMs: 3000,        // default 3000
  timeoutMs: 30 * 60_000,      // default: wait forever
  onProgress: (j) => console.log(j.status, j.progress.percent_complete),
});

for await (const line of spicrawl.batch.results(job.id)) {
  console.log(line.seq, line.status, line.url, line.http_status ?? line.error?.code);
}
```

`create()` is never retried once it may have reached the server, because resubmitting creates and bills a second job. `results()` follows `X-Next-Cursor` across pages; on a running job it stops at the last finished item. Per-item overrides go in `items: [{ url, external_id, js_render }]` instead of `urls`.

### Other batch methods

```ts
const one = await spicrawl.batch.get(job.id);                    // a job and its live progress
for await (const j of spicrawl.batch.list({ status: "running" })) console.log(j.id);
await spicrawl.batch.cancel(job.id);                             // -> cancelling, then cancelled
const again = await spicrawl.batch.retry(job.id);                // re-run every failed item

const open = await spicrawl.batch.create({ urls: ["https://example.com"], open: true });
await spicrawl.batch.append(open.id, { urls: ["https://example.org"] }); // not idempotent
await spicrawl.batch.close(open.id);                             // an open job never finishes on its own

const page1 = await spicrawl.batch.resultsPage(job.id, { limit: 100, status: "failed" }); // one page: { lines, nextCursor }
const item = await spicrawl.batch.taskContent(job.id, 0);        // one item's payload: { content, truncated }
```

## Keep cookies and logins with sessions

A session keeps cookies and web storage across scrapes, so a login carries over to later requests.

```ts
const session = await spicrawl.sessions.create();                // sessions.create(body?)
await spicrawl.scrape({ url: "https://example.com", session_id: session.id, js_render: true });

const same = await spicrawl.sessions.get(session.id);
for await (const s of spicrawl.sessions.list({ limit: 50 })) console.log(s.id);
const ctx = await spicrawl.sessions.context(session.id);         // cookies + storage: contains credentials, never log it
await spicrawl.sessions.release(session.id);                     // stops accepting work, purges context
await spicrawl.sessions.delete(session.id, { force: true });     // force: even while a task holds it
```

## Request history and credit usage

```ts
const recent = await spicrawl.requests.list({ only_errors: "true", limit: 20 });
const trace = await spicrawl.requests.get(recent.data[0].id);    // or an error's requestId

const summary = await spicrawl.usage.summary();                  // plan, credits, allowance, current period
const byDay = await spicrawl.usage.get({ from: "2026-09-01", to: "2026-09-30", group_by: "day" });
const recon = await spicrawl.usage.reconciliation({ day: "2026-09-30" });
```

`requests.list({ all_projects: "true" })` covers every project in the organization and needs a key with the `read` scope.

## Partner accounts

Partner accounts are for platforms that resell Spicrawl to their own users. Each user gets a workspace with its own API key, and every workspace draws on one balance that you fund.

```ts
// Your partner key stays on your server. It cannot scrape: it manages users, tiers and the balance.
const platform = new Spicrawl({ apiKey: process.env.SPICRAWL_PARTNER_KEY });

// Limits every new user starts on: a monthly cap on how much of your balance a user may draw.
await platform.partner.tiers.create({
  name: "Standard", requests_per_minute: 60, concurrency: 2, free_credits: 250, wallet_cap: 500, default: true,
});

// Create the user's workspace. The response carries its API key: store it as their credential.
const { api_key } = await platform.partner.users.create("user-42", { display_name: "Ada" });

// The user's requests use a second client that holds only their key.
const userSpicrawl = new Spicrawl({ apiKey: api_key });
const page = await userSpicrawl.scrape({ url: "https://example.com" });

// Give credits from your balance, then read the balance and the heaviest users.
await platform.partner.users.giveCredits("user-42", { credits: 50 });
const { balance_credits } = await platform.partner.balance();
for await (const u of platform.partner.users.list({ sort: "wallet_used" })) {
  console.log(u.external_user_id, u.wallet_used, u.wallet_cap);
}
```

- `users.create()` is safe to repeat: it returns the same key, or a new one if the stored key can no longer be read, so always store the latest `api_key`. It contains a credential: do not log it.
- A request is paid from the user's free credits, then the credits you gave them, then your balance, up to the user's `wallet_cap`. `wallet_used` and `wallet_cap` on each user show where that stands.
- `giveCredits()` sends an idempotency key: the one you pass, or a UUID the SDK generates. It is returned as `idempotency_key`. To retry an assignment later, pass that key again: a repeat changes nothing and returns `applied: false`. Assigning more than `balance_credits` is `402 ERR::LIMIT::QUOTA_EXCEEDED`; reusing a key for another amount or user is `409`.
- Creating workspaces is limited per UTC day. A refusal is `429 ERR::LIMIT::PARTNER_WORKSPACE_LIMIT` with `Retry-After` up to 00:00 UTC. The SDK throws it instead of sleeping, as for any `Retry-After` over 60 seconds: catch `RateLimitError` and read `retryAfterSeconds`.
- Tier changes and moves between tiers reach requests within about 60 seconds. `partner.usage({ group_by: "workspace" })` reports usage per user, and `partner.users.usage(id, { from, to })` reports one user.
- `spicrawl.key()` reports the scopes and organization of the key a client holds, so code can tell a partner key from a workspace key.

## Brand assets

`brand.get()` returns a site's brand from one JavaScript-rendered page load: identity, logos, icons, colors, fonts, images, videos and social links. It returns links only; nothing is downloaded.

```ts
const brand = await spicrawl.brand.get("https://example.com", { include: ["logos", "colors"] });
console.log(brand.identity?.name, brand.colors?.[0]?.hex, brand._meta.creditsCharged);
```

- Only the sections in `include` come back (all of them by default). Each section is capped, and a section that fails on the page is empty and named in `warnings`.
- Billed like a JavaScript-rendered scrape. `screenshot: true` renders in a full browser and bills that tier. Each call bills again, so the SDK does not retry it after a failure that may have done the work.

## Webhooks

Webhook endpoints receive signed `batch.completed`, `batch.failed`, `monitor.changed` and `monitor.failed` events. The payload is a notification: fetch anything else you need with the API.

```ts
const { secret } = await spicrawl.webhooks.create({
  url: "https://example.com/hooks/spicrawl",
  events: ["monitor.changed"],
  format: "json",
});
// Store `secret` now: it is shown once. Rotate it with rotateSecret().
await spicrawl.webhooks.test(endpointId); // queues a signed ping
```

Verify every delivery against the raw request body, before you parse it:

```ts
import { verifyWebhookSignature } from "@spicrawl/sdk";

const header = req.headers["x-spicrawl-signature"]; // X-Spicrawl-Signature: t=<unix>,v1=<hex>,kid=<n>
const ok = verifyWebhookSignature(rawBody, String(header), process.env.WEBHOOK_SECRET!); // the whsec_ secret from create()
if (!ok) return res.status(400).end();
```

- The header is `X-Spicrawl-Signature: t=<unix>,v1=<hex>,kid=<n>`. The signature is HMAC-SHA256, keyed with the `whsec_` secret's UTF-8 bytes, over `"<t>." + body`. The check is constant-time and rejects a timestamp more than `toleranceSeconds` (default 300) from `now`, in seconds.
- It returns a boolean and is synchronous. It uses `node:crypto`, so it runs on Node.js (and Bun or Deno with Node compatibility); it is not for browsers.
- `deliveries(id)` lists recent attempts, with status and `last_error`. A receiver that fails 100 deliveries in a row is disabled until you re-enable it.

## Monitors

A monitor watches one page, or with `scope: "site"` every page reachable from its URL on the same host. The first successful check records a baseline. Later checks report a change once `confirm_checks` checks in a row agree on the new content.

```ts
const monitor = await spicrawl.monitors.create({
  url: "https://example.com/pricing",
  webhook_endpoint_id: endpointId,
  interval_seconds: 3600,
  selector: ".plans",
  js_render: true,
});
const result = await spicrawl.monitors.check(monitor.id); // check now: outcome "unchanged" | "changed" | "not_modified" | "failed"
const { data: changes } = await spicrawl.monitors.changes(monitor.id, { limit: 10 });
```

- `create()` needs a `url`. Set `webhook_endpoint_id` to receive `monitor.changed` and `monitor.failed`. `interval_seconds` is 60 to 2,592,000. `max_credits_per_run` caps what one check may spend.
- `pages(id)` lists the pages a site monitor tracks; a page that disappears stays listed with `removed_at`. A page monitor answers 404.
- `delete()` stops the checks and removes the change history.

## Remote browser (coming soon)

`spicrawl.browser.token()` and `spicrawl.browser.connectURL()` are typed for the remote CDP browser, which is **not available yet**. They exist so your code will not change when it launches. See the [CDP browser guide](https://docs.spicrawl.com/guides/cdp-browser).

## Pagination

`batch.list()`, `sessions.list()`, `requests.list()`, `partner.users.list()` and `monitors.pages()` return a `PagePromise`. `await` it for one page, or `for await` it to walk every item on every page:

```ts
let page = await spicrawl.requests.list({ limit: 50 });
console.log(page.data.length, page.hasNextPage());
if (page.hasNextPage()) page = await page.getNextPage();
for await (const p of page.iterPages()) console.log(p.data.length);
```

## Response metadata: credits, rate limits, request ids

Every result carries a typed, non-enumerable `_meta` read from the response headers, so it stays out of `JSON.stringify` and spreads:

| Field | Header | Meaning |
|---|---|---|
| `requestId` | `X-Request-Id` | pass to `requests.get()` for the full trace |
| `creditsCharged` | `X-Credits-Charged` | what this call billed |
| `creditsRemaining` | `X-Credits-Remaining` | monthly allowance left after it; `null` when not sent |
| `requestCost` | `X-Request-Cost` | price of the engine that ran |
| `engine` | `X-Engine` | engine that produced the page |
| `cacheState` | `Cache-State` | `hit`, `miss` or `bypass` |
| `targetStatus` | `X-Target-Status` | the target site's status |
| `rateLimit` | `X-RateLimit-*` | `{ limit, remaining, reset }` |
| `warnings` | `X-Warning` | non-fatal `CODE: message` strings |

## Error handling

Every error the SDK throws is a `SpicrawlError`. HTTP errors map to subclasses by status:

| Class | Status | Meaning |
|---|---|---|
| `BadRequestError` | 400, and any status without its own class | invalid or incompatible parameters |
| `AuthenticationError` | 401 | missing, invalid, revoked or expired key |
| `InsufficientCreditsError` | 402 | the monthly credit allowance is used up |
| `PermissionDeniedError` | 403 | missing scope, or engine not entitled |
| `NotFoundError` | 404 | unknown job, session or request |
| `ConflictError` | 409 | e.g. a busy session, or a job already finished |
| `GoneError` | 410 | beyond retention, or a released session |
| `RateLimitError` | 429 | rate, concurrency or live-session limit |
| `InternalServerError` | 5xx | platform failure |
| `APIConnectionError` | none (`status` 0) | DNS failure, refused or reset connection |
| `APITimeoutError` | none (`status` 0) | `timeoutMs` exceeded; subclass of `APIConnectionError` |

Each error carries `status`, `code` (a stable `ERR::FAMILY::NAME`), `retryable` (the server's verdict), `retryAfterSeconds`, `requestId`, `diagnostics.hint`, the raw `problem` body and `fix`: when the platform can build one, the corrected request (for example `method` added for a body). Review `fix` before you resend it; the SDK never resends it for you. `ERROR_CODES` lists all 57 documented codes.

```ts
import { Spicrawl, RateLimitError, isSpicrawlError } from "@spicrawl/sdk";

const spicrawl = new Spicrawl();
try {
  await spicrawl.scrape({ url: "https://example.com" });
} catch (err) {
  if (err instanceof RateLimitError) console.log("retry in", err.retryAfterSeconds, "s");
  else if (isSpicrawlError(err)) console.log(err.code, err.retryable, err.diagnostics?.hint, err.requestId);
  else throw err;
}
```

## Report a failed request

When a request fails for a reason that is ours to fix, the error is reportable: `err.isReportable` is true and `err.feedbackUrl` is set. Send a thumbs-down with `feedback()` and the request's `requestId`:

```ts
import { Spicrawl, isSpicrawlError } from "@spicrawl/sdk";

const spicrawl = new Spicrawl();
try {
  return await spicrawl.scrape({ url: "https://example.com/pricing", js_render: true });
} catch (err) {
  if (isSpicrawlError(err) && err.isReportable && err.requestId) {
    await spicrawl.feedback({ requestId: err.requestId, intent: "read the pricing page for a comparison" });
  }
  throw err;
}
```

- `rating` defaults to `"down"`. You can also pass `kind` (`broken`, `wrong_result`, `missing`, `confusing`, `other`), `impact` (`blocked`, `worked_around`, `friction`), `intent`, `comment` and `agent`.
- A thumbs-down on a charged request refunds its credits, up to a daily cap. `refundCapReached` is true once the cap is hit.
- Sending feedback again for the same request returns `alreadySubmitted: true` and records nothing new.

## Retries and timeouts

Most calls carry no idempotency key, so a repeated scrape is a second, billed scrape. Only partner credit assignment (`users.giveCredits()`) sends one. The SDK retries accordingly:

- `maxRetries` defaults to **2** retries after the first attempt.
- Backoff is exponential with jitter: about 0.5 s, 1 s, 2 s, capped at 8 s.
- A `Retry-After` header (or `retry_after_seconds` in the body) is honoured up to **60 s**. A longer wait is thrown as the error instead.
- A server answer of `retryable: false` is never retried.

| Failure | GET, PUT, DELETE | POST, PATCH (scrape, batch, sessions, partner edits) | `users.giveCredits()` (POST with an idempotency key) |
|---|---|---|---|
| Connection error | retried | retried only if the connection never opened | retried |
| Timeout | retried | never: the server may still be working and billing | retried |
| 408, 5xx | retried | never | retried |
| 429 | retried | retried: it is refused before any work | retried |
| Other 4xx | never | never | never |

PUT is retried like a GET: it is idempotent by HTTP rules (create-or-fetch a workspace, set a tier). PATCH edits a record, so it follows POST. `giveCredits()` is retried like an idempotent call because its key makes a repeat a no-op; the SDK sends the same key on every attempt.

`timeoutMs` is **per attempt** and defaults to **180,000 ms** (3 minutes, because browser renders can be slow). An `AbortSignal` cancels the request and any pending retry sleep. Override any of these per client or per call:

```ts
const strict = new Spicrawl({ maxRetries: 0, timeoutMs: 60_000 });
await spicrawl.scrape(
  { url: "https://example.com" },
  { timeoutMs: 30_000, maxRetries: 0, signal: AbortSignal.timeout(45_000), headers: { "X-Trace": "abc" } },
);
```

## Configuration

| Option | Environment variable | Default |
|---|---|---|
| `apiKey` | `SPICRAWL_API_KEY` | required; the constructor throws without one |
| `baseURL` | `SPICRAWL_BASE_URL` | `https://api.spicrawl.com` |
| `timeoutMs` | none | `180000`, per attempt |
| `maxRetries` | none | `2` |
| `fetch` | none | `globalThis.fetch` (pass your own for a proxy agent or tests) |
| `defaultHeaders` | none | `{}`, sent with every request |

## Runtime support

| Runtime | Status |
|---|---|
| Node.js 18 and later | Supported (`engines: { node: ">=18" }`); CI runs Node.js 22 |
| ESM (`import`) | `dist/index.js` with `index.d.ts` |
| CommonJS (`require`) | `dist/index.cjs` with `index.d.cts` |
| Bun, Deno, edge runtimes | Not tested. The SDK needs only the standard `fetch`, `AbortController`, `Headers` and `Response`; pass `apiKey` where there is no `process.env` |
| Browsers | Not supported: never ship an API key to a browser. Call Spicrawl from your server |

```js
const { Spicrawl } = require("@spicrawl/sdk"); // CommonJS
```

## Use with AI agents

Give a model a web-reading tool by wrapping one SDK call. This uses the Anthropic SDK (`npm install @anthropic-ai/sdk`) with a manual tool loop:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { Spicrawl } from "@spicrawl/sdk";

const spicrawl = new Spicrawl();
const anthropic = new Anthropic();

const tools: Anthropic.Tool[] = [{
  name: "fetch_page",
  description: "Fetch a web page and return its main content as Markdown.",
  input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
}];

async function fetchPage(url: string): Promise<string> {
  const page = await spicrawl.scrapeRaw({ url, response_format: "markdown", main_content_only: true });
  return page.format === "markdown" ? page.body : "";
}

const messages: Anthropic.MessageParam[] = [{ role: "user", content: "Summarise https://example.com" }];
for (;;) {
  const res = await anthropic.messages.create({ model: "claude-opus-5-5", max_tokens: 16000, tools, messages });
  messages.push({ role: "assistant", content: res.content });
  if (res.stop_reason !== "tool_use") break;
  const results: Anthropic.ToolResultBlockParam[] = [];
  for (const block of res.content) {
    if (block.type !== "tool_use") continue;
    const { url } = block.input as { url: string };
    results.push({ type: "tool_result", tool_use_id: block.id, content: await fetchPage(url) });
  }
  messages.push({ role: "user", content: results });
}
```

With the OpenAI SDK, pass the same function as a `function` tool and answer each `tool_calls` entry with a `tool` message:

```ts
import OpenAI from "openai";

const openai = new OpenAI();
const completion = await openai.chat.completions.create({
  model: "gpt-5",
  messages: [{ role: "user", content: "Summarise https://example.com" }],
  tools: [{
    type: "function",
    function: {
      name: "fetch_page",
      description: "Fetch a web page and return its main content as Markdown.",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    },
  }],
});
for (const call of completion.choices[0].message.tool_calls ?? []) {
  if (call.type !== "function") continue;
  const markdown = await fetchPage(JSON.parse(call.function.arguments).url); // fetchPage from above
  // send back { role: "tool", tool_call_id: call.id, content: markdown }, then call the model again
}
```

## SDK vs CLI vs MCP vs REST API

- **If you write Node.js or TypeScript code**, use this SDK: typed requests and errors, pagination, batch helpers and billing-safe retries.
- **If you work in a terminal, a shell script or CI**, use the [Spicrawl CLI](https://github.com/OfficialSpicrawl/cli) (`npm install -g @spicrawl/cli`).
- **If an AI agent (Claude Code, Cursor, Codex, VS Code) should decide what to fetch**, connect it to the hosted MCP server at `https://mcp.spicrawl.com/mcp` with `Authorization: Bearer <API key>`. See the [MCP guide](https://docs.spicrawl.com/agents/mcp), [`@spicrawl/mcp`](https://github.com/OfficialSpicrawl/mcp) and [OfficialSpicrawl/agent-plugins](https://github.com/OfficialSpicrawl/agent-plugins).
- **If you use another language**, call the REST API directly. See the [API reference](https://docs.spicrawl.com/api-reference/introduction).

## FAQ

### Is Spicrawl free?

Spicrawl bills credits per successful request, and every organization gets a monthly credit allowance: during the beta, one plan of 1,000 credits per month. A plain fetch costs 1 credit, `js_render` 3 and full-browser rendering (screenshots, PDF, `actions`) 8; failed requests cost 0. See [Credits](https://docs.spicrawl.com/credits).

### Are cached results free?

No. A cache hit is billed at the same price as the fetch that stored it; the cache saves latency and load on the target site, not credits. Send `cache: false` for a fresh fetch at no extra cost. See [Caching](https://docs.spicrawl.com/guides/caching).

### Does it render JavaScript?

Yes. Set `js_render: true` for JavaScript rendering, or `mode: "auto"` to escalate from a plain fetch only when needed (screenshots, PDF and `actions` use full-browser rendering, which Spicrawl picks for you); `wait_for` waits for a CSS selector.

### Why didn't my scrape throw when the site returned 404?

The site's status is data, not an error. Read it from `status` in the envelope, `targetStatus` in raw mode, or `_meta.targetStatus`.

### Can a retry bill me twice?

Not from the SDK's own retries. Scrape, batch and session POSTs are retried only on 429 or when the connection never opened, both cases where no work was done. Partner credit assignment is also retried on 5xx and timeouts, because its idempotency key makes a repeat a no-op. Your own retry of a scrape that succeeded is billed again.

### Can I crawl a whole website?

Not with one call: there is no site-crawl or sitemap endpoint. Collect URLs with `links: true`, then submit them as a batch job.

### Does it work with Claude Code or Cursor?

The SDK is for your own code. For Claude Code, Cursor, Codex or VS Code, use the hosted MCP server, or run `npx @spicrawl/cli init` to configure them. See the [MCP guide](https://docs.spicrawl.com/agents/mcp).

### Is there a hosted MCP server?

Yes, at `https://mcp.spicrawl.com/mcp`, authenticated with `Authorization: Bearer <API key>`.

### Is the SDK open source?

Yes, under Apache-2.0 at [github.com/OfficialSpicrawl/sdk](https://github.com/OfficialSpicrawl/sdk). The Spicrawl API it calls is a hosted service.

## Links

- Documentation: <https://docs.spicrawl.com>, with [llms.txt](https://docs.spicrawl.com/llms.txt) for AI agents
- Dashboard and API keys: <https://app.spicrawl.com>
- Runnable examples: [scrape-to-markdown.ts](https://github.com/OfficialSpicrawl/sdk/blob/main/examples/scrape-to-markdown.ts), [extract-product.ts](https://github.com/OfficialSpicrawl/sdk/blob/main/examples/extract-product.ts), [batch-crawl.ts](https://github.com/OfficialSpicrawl/sdk/blob/main/examples/batch-crawl.ts)
- Bugs and feature requests: <https://github.com/OfficialSpicrawl/sdk/issues>

## License

[Apache-2.0](https://github.com/OfficialSpicrawl/sdk/blob/main/LICENSE)
