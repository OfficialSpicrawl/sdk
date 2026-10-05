# Changelog

All notable changes to `@spicrawl/sdk` are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## 0.1.3 — 2026-10-05

- The repository moved to https://github.com/OfficialSpicrawl/sdk; the npm page links it and the provenance attestation is tied to it. No API changes.
- README rewritten: one section per public method with snippets that typecheck against the SDK, the error classes and the retry and timeout rules as implemented, a runtime table, Anthropic and OpenAI tool-calling examples, "SDK vs CLI vs MCP vs REST" guidance and an FAQ.
- **Docs fix:** the README said cache hits cost 0 credits. A cache hit is billed at the price of the fetch that stored it, as the API documents.
- Package description, keywords and homepage updated. No code change.

## 0.1.2 — 2026-09-30

- The source is public at https://github.com/OfficialSpicrawl/sdk, and the npm page links it (`repository`, `bugs`). Releases are published from that repo's CI with an npm provenance attestation.
- `_meta.creditsRemaining`: the `X-Credits-Remaining` header, your organization's monthly allowance left after the call (after the hold, on a batch submit, append or retry), in whole credits. `null` when the organization has no monthly limit or the API did not send it.
- The docs moved to the root of their own host: https://docs.spicrawl.com/… (no `/docs` segment). The README and package page link there; old `https://docs.spicrawl.com/docs/…` links redirect. No code change: `SpicrawlError.docUrl` is whatever the API sends.
- README: repo, API-key and changelog links; a "Use with AI agents" section; a typed JSON Schema extraction example; the runnable examples linked. AI extraction (`ai_extract`) is marked coming soon, as it is in the API docs.
- Package description and keywords rewritten for npm search.

## 0.1.1 — 2026-09-28

- **Fix:** the default API host is `https://api.spicrawl.com`. 0.1.0 defaulted to the same name under `.dev`, which does not exist; set `baseURL` or `SPICRAWL_BASE_URL` if you are on 0.1.0.
- Docs links in the README and package page point at https://docs.spicrawl.com/docs/…; the old paths without `/docs` returned 404.

## 0.1.0 — 2026-09-26

- Republished after the earlier releases were removed from npm (npm never reuses a version number).

## 0.0.2 — 2026-09-25

- The npm page links to the docs at https://docs.spicrawl.com and no longer links the private source repository.

## 0.0.1 — 2026-09-25

First public release of the official Spicrawl SDK for JavaScript and TypeScript.

- `Spicrawl` client with zero runtime dependencies (native `fetch`, Node.js >= 18), dual ESM + CJS builds and bundled type definitions.
- `scrape()` returns the typed JSON envelope; `scrapeRaw()` returns html / markdown / text as a string and pdf as an `ArrayBuffer`.
- Resources: `batch` (create, get, list, cancel, retry, close, append, results, resultsPage, taskContent, waitForCompletion), `sessions` (create, get, list, delete, release, context), `requests` (list, get), `usage` (get, summary, reconciliation), and `browser` (token, connectURL — coming soon).
- List methods return pages that are also async-iterable across every page, for both cursor (`next_cursor`) and keyset (`before` / `before_id`) pagination.
- Response metadata (request id, credits charged, rate limit, engine, cache state, target status, warnings) on a non-enumerable `_meta`.
- Typed error hierarchy (`SpicrawlError` and subclasses) carrying the platform's `code`, `retryable`, `diagnostics` and `requestId`.
- Billing-safe retries: GET/DELETE retry on connection errors, 408, 429 and retryable 5xx; POST retries only on 429 and on connections that never opened.
- Types generated from the OpenAPI spec with `openapi-typescript`.
