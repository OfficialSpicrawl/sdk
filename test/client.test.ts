import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  APIConnectionError,
  APITimeoutError,
  AuthenticationError,
  ConflictError,
  ERROR_CODES,
  InsufficientCreditsError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  VERSION,
  Spicrawl,
  isSpicrawlError,
  type BatchJob,
} from "../src/index.js";

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

interface Call {
  url: string;
  init: RequestInit;
}

function mock(...handlers: Handler[]) {
  const calls: Call[] = [];
  let i = 0;
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const h = handlers[Math.min(i++, handlers.length - 1)]!;
    return h(url, init);
  };
  const sleeps: number[] = [];
  const client = new Spicrawl({ apiKey: "spicrawl_test_abc", baseURL: "https://api.test", fetch });
  client._transport.sleep = async (ms) => {
    sleeps.push(ms);
  };
  return { client, calls, sleeps };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const problem = (status: number, code: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  new Response(
    JSON.stringify({
      type: "https://docs.spicrawl.com/errors#x",
      title: "t",
      status,
      code,
      detail: `detail for ${code}`,
      retryable: false,
      doc_url: "https://docs.spicrawl.com/errors",
      target_status: null,
      request_id: "01REQ",
      ...extra,
    }),
    { status, headers: { "content-type": "application/problem+json", ...headers } },
  );

const envelope = {
  url: "https://example.com",
  final_url: "https://example.com",
  status: 200,
  content: "<html></html>",
  headers: {},
  truncated: false,
  credits: 1,
  engine: "fetch",
  proxy_source: "pool",
  warnings: [],
};

const connRefused = () => {
  const err = new TypeError("fetch failed");
  (err as { cause?: unknown }).cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  throw err;
};
const connReset = () => {
  const err = new TypeError("fetch failed");
  (err as { cause?: unknown }).cause = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
  throw err;
};

describe("client basics", () => {
  it("version matches package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(VERSION).toBe(pkg.version);
  });

  it("sends bearer auth, user agent and JSON body", async () => {
    const { client, calls } = mock(() => json(envelope, 200, { "x-engine": "fetch" }));
    await client.scrape({ url: "https://example.com" });
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(calls[0]!.url).toBe("https://api.test/v1/scrape");
    expect(h.Authorization).toBe("Bearer spicrawl_test_abc");
    expect(h["User-Agent"]).toBe(`spicrawl-sdk-js/${VERSION}`);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ url: "https://example.com", response_format: "json" });
  });

  it("reads the key and base URL from the environment", () => {
    process.env.SPICRAWL_API_KEY = "spicrawl_test_env";
    process.env.SPICRAWL_BASE_URL = "https://env.test/";
    try {
      const c = new Spicrawl({ fetch: async () => json({}) });
      expect(c._transport.apiKey).toBe("spicrawl_test_env");
      expect(c.baseURL).toBe("https://env.test");
    } finally {
      delete process.env.SPICRAWL_API_KEY;
      delete process.env.SPICRAWL_BASE_URL;
    }
  });

  it("throws without a key", () => {
    expect(() => new Spicrawl({ fetch: async () => json({}) })).toThrow(/SPICRAWL_API_KEY/);
  });

  it("exposes response meta on a non-enumerable _meta", async () => {
    const { client } = mock(() =>
      json(envelope, 200, {
        "x-engine": "js",
        "x-request-id": "01ABC",
        "x-credits-charged": "3",
        "x-credits-remaining": "997",
        "x-request-cost": "3",
        "x-ratelimit-limit": "100",
        "x-ratelimit-remaining": "99",
        "x-ratelimit-reset": "30",
        "cache-state": "miss",
        "x-target-status": "200",
        "x-warning": "ESCALATED: moved to browser",
      }),
    );
    const r = await client.scrape({ url: "https://example.com" });
    expect(r._meta).toMatchObject({
      requestId: "01ABC",
      creditsCharged: 3,
      creditsRemaining: 997,
      engine: "js",
      cacheState: "miss",
      targetStatus: 200,
      rateLimit: { limit: 100, remaining: 99, reset: 30 },
      warnings: ["ESCALATED: moved to browser"],
    });
    expect(Object.keys(r)).not.toContain("_meta");
    expect(JSON.parse(JSON.stringify(r))).toEqual(envelope);
  });

  it("per-request headers are sent", async () => {
    const { client, calls } = mock(() => json({ sessions: [] }));
    await client.sessions.list({}, { headers: { "X-Trace": "1" } });
    expect((calls[0]!.init.headers as Record<string, string>)["X-Trace"]).toBe("1");
  });

  it("scrape() sends method and body on the wire", async () => {
    const { client, calls } = mock(() => json(envelope));
    await client.scrape({ url: "https://example.com", method: "POST", body: { q: 1 } } as never);
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ method: "POST", body: { q: 1 } });
  });

  it("SpicrawlError exposes the problem's fix", async () => {
    const fix = { method: "POST", body: "a=1" };
    const { client } = mock(() => problem(400, "ERR::REQUEST::BODY_NEEDS_METHOD", { fix }));
    const err = await client.scrape({ url: "https://example.com", body: "a=1" } as never).catch((e) => e);
    expect(err.fix).toEqual(fix);
    const { client: c2 } = mock(() => problem(400, "ERR::REQUEST::INVALID"));
    expect((await c2.scrape({ url: "x" }).catch((e) => e)).fix).toBeUndefined();
  });

  it("scrape() refuses non-json formats", async () => {
    const { client } = mock(() => json(envelope));
    await expect(client.scrape({ url: "x", response_format: "markdown" } as never)).rejects.toThrow(/scrapeRaw/);
  });
});

describe("errors", () => {
  const cases: [number, string, new (...a: never[]) => Error][] = [
    [401, "ERR::AUTH::INVALID_KEY", AuthenticationError],
    [402, "ERR::LIMIT::QUOTA_EXCEEDED", InsufficientCreditsError],
    [403, "ERR::AUTH::INSUFFICIENT_SCOPE", PermissionDeniedError],
    [404, "ERR::SESSION::NOT_FOUND", NotFoundError],
    [429, "ERR::LIMIT::RATE_LIMITED", RateLimitError],
  ];
  for (const [status, code, Cls] of cases) {
    it(`maps ${status} to ${Cls.name}`, async () => {
      const { client } = mock(() => problem(status, code));
      const err = await client.sessions.get("s1", { maxRetries: 0 }).catch((e) => e);
      expect(err).toBeInstanceOf(Cls);
      expect(isSpicrawlError(err)).toBe(true);
      expect(err.status).toBe(status);
      expect(err.code).toBe(code);
      expect(err.requestId).toBe("01REQ");
      expect(err.docUrl).toBe("https://docs.spicrawl.com/errors");
    });
  }

  it("carries diagnostics, target status and retry-after", async () => {
    const { client } = mock(() =>
      problem(502, "ERR::UPSTREAM::CHALLENGE", {
        target_status: 403,
        retryable: true,
        retry_after_seconds: 5,
        diagnostics: { hint: "set premium_proxy=true" },
      }),
    );
    const err = await client.scrape({ url: "https://example.com" }).catch((e) => e);
    expect(err).toBeInstanceOf(InternalServerError);
    expect(err.targetStatus).toBe(403);
    expect(err.retryable).toBe(true);
    expect(err.retryAfterSeconds).toBe(5);
    expect(err.diagnostics.hint).toMatch(/premium_proxy/);
  });

  it("a relayed target status on a completed scrape is NOT an error", async () => {
    const { client } = mock(
      () =>
        new Response("<h1>Not found</h1>", {
          status: 404,
          headers: { "content-type": "text/html", "x-engine": "fetch", "x-target-status": "404" },
        }),
    );
    const r = await client.scrapeRaw({ url: "https://example.com/missing", response_format: "html", original_status: true });
    expect(r.format).toBe("html");
    expect(r.body).toBe("<h1>Not found</h1>");
    expect(r.targetStatus).toBe(404);
    expect(r._meta.status).toBe(404);
  });

  it("a non-2xx gateway page without X-Engine IS an error", async () => {
    const { client } = mock(() => new Response("<html>bad gateway</html>", { status: 404, headers: { "content-type": "text/html" } }));
    await expect(client.scrapeRaw({ url: "https://example.com" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("retry policy", () => {
  it("POST is not retried on 500", async () => {
    const { client, calls } = mock(() => problem(500, "ERR::INTERNAL::ERROR", { retryable: true }));
    await expect(client.scrape({ url: "https://example.com" })).rejects.toBeInstanceOf(InternalServerError);
    expect(calls).toHaveLength(1);
  });

  it("POST is not retried on a connection reset (may have been sent)", async () => {
    const { client, calls } = mock(connReset);
    await expect(client.batch.create({ urls: ["https://a"] })).rejects.toBeInstanceOf(APIConnectionError);
    expect(calls).toHaveLength(1);
  });

  it("POST is retried on ECONNREFUSED (never sent)", async () => {
    const { client, calls } = mock(connRefused, () => json(envelope));
    await client.scrape({ url: "https://example.com" });
    expect(calls).toHaveLength(2);
  });

  it("POST is retried on 429 honouring Retry-After", async () => {
    const { client, calls, sleeps } = mock(
      () => problem(429, "ERR::LIMIT::RATE_LIMITED", { retryable: true }, { "retry-after": "7" }),
      () => json(envelope),
    );
    await client.scrape({ url: "https://example.com" });
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([7000]);
  });

  it("429 with an explicit retryable: false is not retried", async () => {
    const { client, calls } = mock(() => problem(429, "ERR::LIMIT::RATE_LIMITED", { retryable: false }));
    await expect(client.scrape({ url: "https://example.com" })).rejects.toBeInstanceOf(RateLimitError);
    expect(calls).toHaveLength(1);
  });

  it("POST is not retried on timeout", async () => {
    const calls: number[] = [];
    const client = new Spicrawl({
      apiKey: "k",
      baseURL: "https://api.test",
      timeoutMs: 20,
      fetch: (_u, init) =>
        new Promise((_res, rej) => {
          calls.push(1);
          init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    });
    await expect(client.scrape({ url: "x" })).rejects.toBeInstanceOf(APITimeoutError);
    expect(calls).toHaveLength(1);
  });

  it("GET is retried on 503 and connection errors, then succeeds", async () => {
    const { client, calls, sleeps } = mock(
      () => problem(503, "ERR::INTERNAL::UNAVAILABLE", { retryable: true, retry_after_seconds: 2 }),
      connReset,
      () => json({ id: "s1" }),
    );
    const s = await client.sessions.get("s1");
    expect(s.id).toBe("s1");
    expect(calls).toHaveLength(3);
    expect(sleeps[0]).toBe(2000);
  });

  it("GET is not retried when the server says retryable=false", async () => {
    const { client, calls } = mock(() => problem(500, "ERR::SESSION::STATE_CORRUPT", { retryable: false }));
    await expect(client.sessions.context("s1")).rejects.toBeInstanceOf(InternalServerError);
    expect(calls).toHaveLength(1);
  });

  it("stops after maxRetries", async () => {
    const { client, calls } = mock(() => problem(503, "ERR::INTERNAL::UNAVAILABLE", { retryable: true }));
    await expect(client.usage.summary()).rejects.toBeInstanceOf(InternalServerError);
    expect(calls).toHaveLength(3);
  });

  it("DELETE is retried and sends force", async () => {
    const { client, calls } = mock(connReset, () => new Response(null, { status: 204 }));
    await client.sessions.delete("s1", { force: true });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toBe("https://api.test/v1/sessions/s1?force=true");
    expect(calls[1]!.init.method).toBe("DELETE");
  });
});

describe("pagination", () => {
  it("cursor style: iterates sessions across pages", async () => {
    const { client, calls } = mock(
      () => json({ sessions: [{ id: "a" }, { id: "b" }], next_cursor: "c1" }),
      () => json({ sessions: [{ id: "c" }] }),
    );
    const ids: string[] = [];
    for await (const s of client.sessions.list({ limit: 2 })) ids.push(s.id);
    expect(ids).toEqual(["a", "b", "c"]);
    expect(calls[1]!.url).toBe("https://api.test/v1/sessions?limit=2&cursor=c1");
  });

  it("cursor style: await gives the first page", async () => {
    const { client } = mock(() => json({ batches: [{ id: "j1" }], next_cursor: "n" }));
    const page = await client.batch.list();
    expect(page.data.map((b) => b.id)).toEqual(["j1"]);
    expect(page.hasNextPage()).toBe(true);
    expect(page.body.next_cursor).toBe("n");
  });

  it("keyset style: iterates requests with before/before_id", async () => {
    const { client, calls } = mock(
      () =>
        json({
          data: [{ id: "r1" }],
          page: { retention_hours: 24, retained_since: "x", has_more: true, next_before: "2026-01-01T00:00:00Z", next_before_id: "r1" },
        }),
      () => json({ data: [{ id: "r2" }], page: { retention_hours: 24, retained_since: "x", has_more: false } }),
    );
    const ids: string[] = [];
    for await (const r of client.requests.list({ only_errors: "true" })) ids.push((r as { id: string }).id);
    expect(ids).toEqual(["r1", "r2"]);
    expect(calls[1]!.url).toBe(
      "https://api.test/v1/requests?only_errors=true&before=2026-01-01T00%3A00%3A00Z&before_id=r1",
    );
  });

  it("keyset style: all_projects rides along on every page", async () => {
    const { client, calls } = mock(
      () =>
        json({
          data: [{ id: "r1", project_id: "p1" }],
          page: { retention_hours: 24, retained_since: "x", has_more: true, next_before: "2026-01-01T00:00:00Z", next_before_id: "r1" },
        }),
      () => json({ data: [{ id: "r2", project_id: "p2" }], page: { retention_hours: 24, retained_since: "x", has_more: false } }),
    );
    const projects: string[] = [];
    for await (const r of client.requests.list({ all_projects: "true" })) projects.push(r.project_id);
    expect(projects).toEqual(["p1", "p2"]);
    expect(calls[0]!.url).toBe("https://api.test/v1/requests?all_projects=true");
    expect(calls[1]!.url).toBe(
      "https://api.test/v1/requests?all_projects=true&before=2026-01-01T00%3A00%3A00Z&before_id=r1",
    );
  });

  it("list is lazy until awaited", async () => {
    const { client, calls } = mock(() => json({ sessions: [] }));
    const p = client.sessions.list();
    expect(calls).toHaveLength(0);
    await p;
    expect(calls).toHaveLength(1);
  });

  it("usage metrics are comma-joined", async () => {
    const { client, calls } = mock(() => json({}));
    await client.usage.get({ group_by: "day", metrics: ["requests", "credits"] as never });
    expect(calls[0]!.url).toBe("https://api.test/v1/usage?group_by=day&metrics=requests%2Ccredits");
  });
});

describe("batch", () => {
  const ndjson = (lines: object[], next?: string) =>
    new Response(lines.map((l) => JSON.stringify(l)).join("\n") + "\n", {
      status: 200,
      headers: { "content-type": "application/x-ndjson; charset=utf-8", ...(next ? { "x-next-cursor": next } : {}) },
    });
  const line = (seq: number) => ({ seq, url: `https://e/${seq}`, status: "succeeded", attempts: 1, credits_micro: 0, bytes: 1, duration_ms: 1 });

  it("results parses NDJSON across cursor pages", async () => {
    const { client, calls } = mock(() => ndjson([line(0), line(1)], "0a"), () => ndjson([line(2)]));
    const seqs: number[] = [];
    for await (const l of client.batch.results("JOB", { limit: 2 })) seqs.push(l.seq);
    expect(seqs).toEqual([0, 1, 2]);
    expect(calls[1]!.url).toBe("https://api.test/v1/batch/JOB/results?limit=2&cursor=0a");
  });

  it("waitForCompletion polls until terminal", async () => {
    const job = (status: string) => ({ id: "JOB", status, progress: {} }) as unknown as BatchJob;
    const { client, calls, sleeps } = mock(() => json(job("queued")), () => json(job("running")), () => json(job("completed")));
    const seen: string[] = [];
    const done = await client.batch.waitForCompletion("JOB", { pollIntervalMs: 10, onProgress: (j) => seen.push(j.status) });
    expect(done.status).toBe("completed");
    expect(seen).toEqual(["queued", "running", "completed"]);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([10, 10]);
  });

  it("waitForCompletion times out", async () => {
    const { client } = mock(() => json({ id: "JOB", status: "running", open: true }));
    await expect(client.batch.waitForCompletion("JOB", { timeoutMs: 0 })).rejects.toThrow(/close/);
  });

  it("append posts items", async () => {
    const { client, calls } = mock(() => json({ job: {}, items_added: 1, items_dispatched: 1 }, 202));
    await client.batch.append("JOB", { items: [{ url: "https://e/9" }] });
    expect(calls[0]!.url).toBe("https://api.test/v1/batch/JOB/items");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ items: [{ url: "https://e/9" }] });
  });

  it("taskContent reports truncation", async () => {
    const { client } = mock(() => json("<html>", 200, { "x-content-truncated": "true" }));
    const r = await client.batch.taskContent("JOB", 3);
    expect(r.content).toBe("<html>");
    expect(r.truncated).toBe(true);
  });
});

describe("raw formats", () => {
  it("markdown", async () => {
    const { client } = mock(
      () => new Response("# Title", { headers: { "content-type": "text/markdown; charset=utf-8", "x-engine": "fetch", "x-credits-charged": "1" } }),
    );
    const r = await client.scrapeRaw({ url: "https://e", response_format: "markdown" });
    expect(r.format).toBe("markdown");
    expect(r.body).toBe("# Title");
    expect(r._meta.creditsCharged).toBe(1);
    // An org with no ceiling gets no X-Credits-Remaining: null, not 0.
    expect(r._meta.creditsRemaining).toBeNull();
  });

  it("text", async () => {
    const { client } = mock(() => new Response("hello", { headers: { "content-type": "text/plain" } }));
    const r = await client.scrapeRaw({ url: "https://e", response_format: "text" });
    expect(r).toMatchObject({ format: "text", body: "hello" });
  });

  it("pdf as ArrayBuffer", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff]);
    const { client } = mock(() => new Response(bytes, { headers: { "content-type": "application/pdf" } }));
    const r = await client.scrapeRaw({ url: "https://e", response_format: "pdf" });
    expect(r.format).toBe("pdf");
    expect(new Uint8Array(r.body as ArrayBuffer)).toEqual(bytes);
  });

  it("json coerced envelope", async () => {
    const { client } = mock(() => json(envelope));
    const r = await client.scrapeRaw({ url: "https://e", response_format: "markdown", links: true });
    expect(r.format).toBe("json");
    if (r.format === "json") expect(r.envelope.engine).toBe("fetch");
  });
});

describe("browser (coming soon)", () => {
  it("connectURL builds a wss URL", () => {
    const { client } = mock(() => json({}));
    expect(client.browser.connectURL({ proxy_country: "de" })).toBe("wss://api.test/v1/browser?proxy_country=de");
    expect(client.browser.connectURL({ proxy_country: "de", includeApiKey: true })).toBe(
      "wss://api.test/v1/browser?proxy_country=de&apikey=spicrawl_test_abc",
    );
    expect(client.browser.connectURL({ token: "wbt_x" })).toBe("wss://api.test/v1/browser?token=wbt_x");
  });
});

describe("key and partner accounts", () => {
  const id = "acct:7.eu_west";
  const enc = "acct%3A7.eu_west";
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const ws = (user: string) => ({
    workspace_id: "W1",
    external_user_id: user,
    status: "active",
    created_at: "2026-11-18T09:00:00Z",
    free_credits: 250,
    display_name: null,
  });
  const assigned = { external_user_id: id, credits: 50, applied: true, user_credits: 50, balance_available: 830 };
  const body = (c: Call) => JSON.parse(c.init.body as string);
  const path = (c: Call) => `${c.init.method} ${c.url.replace("https://api.test", "")}`;
  const hang: Handler = (_u, init) =>
    new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));

  it("key() is a GET of /v1/key and carries _meta", async () => {
    const { client, calls } = mock(() => json({ key_id: "k1", name: "Default", prefix: "spicrawl_live_a1b2", scopes: ["partner", "read"], environment: "live", organization: { id: "o1", name: "Acme" }, partner: true, created_at: "2026-11-18T09:00:00Z", expires_at: null }, 200, { "x-request-id": "01K" }));
    const k = await client.key();
    expect(path(calls[0]!)).toBe("GET /v1/key");
    expect(k.partner).toBe(true);
    expect(k._meta.requestId).toBe("01K");
  });

  it("reads the account: summary and balance are GETs", async () => {
    const { client, calls } = mock(() => json({}));
    await client.partner.summary();
    await client.partner.balance();
    expect(calls.map(path)).toEqual(["GET /v1/partner/summary", "GET /v1/partner/wallet"]);
  });

  it("usage passes the window, grouping and paging through", async () => {
    const { client, calls } = mock(() => json({}));
    await client.partner.usage({ from: "2026-11-01", to: "2026-11-03", group_by: "workspace", sort: "credits", limit: 10, offset: 20 });
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/partner/usage?from=2026-11-01&to=2026-11-03&group_by=workspace&sort=credits&limit=10&offset=20",
    );
  });

  it("create is a PUT with an encoded id and an optional body; created tells 201 from 200", async () => {
    const { client, calls } = mock(
      () => json({ ...ws(id), created: true, api_key: "spicrawl_live_x" }, 201),
      () => json({ ...ws(id), created: false, api_key: "spicrawl_live_x" }, 200),
    );
    const first = await client.partner.users.create(id, { tier: "Standard", display_name: "Ana" });
    expect(first.created).toBe(true);
    expect(first.api_key).toBe("spicrawl_live_x");
    expect(path(calls[0]!)).toBe(`PUT /v1/partner/workspaces/${enc}`);
    expect(body(calls[0]!)).toEqual({ tier: "Standard", display_name: "Ana" });
    const again = await client.partner.users.create(id);
    expect(again.created).toBe(false);
    expect(calls[1]!.init.body).toBeUndefined();
  });

  it("the single-user routes use the right method, path and body", async () => {
    const { client, calls } = mock(() => json(ws(id)));
    await client.partner.users.get(id);
    await client.partner.users.update(id, { display_name: null });
    await client.partner.users.suspend(id);
    await client.partner.users.reactivate(id);
    await client.partner.users.setTier(id, "Gold");
    await client.partner.users.usage(id, { from: "2026-11-01", to: "2026-11-03" });
    expect(calls.map(path)).toEqual([
      `GET /v1/partner/workspaces/${enc}`,
      `PATCH /v1/partner/workspaces/${enc}`,
      `POST /v1/partner/workspaces/${enc}/suspend`,
      `POST /v1/partner/workspaces/${enc}/reactivate`,
      `PUT /v1/partner/workspaces/${enc}/tier`,
      `GET /v1/partner/workspaces/${enc}/usage?from=2026-11-01&to=2026-11-03`,
    ]);
    expect(body(calls[1]!)).toEqual({ display_name: null });
    expect(body(calls[4]!)).toEqual({ tier: "Gold" });
  });

  it("list follows next_after across pages in the default sort, with no repeats or gaps", async () => {
    const { client, calls } = mock(
      () => json({ workspaces: [ws("a"), ws("b")], next_after: "b" }),
      () => json({ workspaces: [ws("c"), ws("d")], next_after: "d" }),
      () => json({ workspaces: [ws("e")] }),
    );
    const seen: string[] = [];
    for await (const w of client.partner.users.list({ limit: 2 })) seen.push(w.external_user_id);
    expect(seen).toEqual(["a", "b", "c", "d", "e"]);
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.test/v1/partner/workspaces?limit=2",
      "https://api.test/v1/partner/workspaces?limit=2&after=b",
      "https://api.test/v1/partner/workspaces?limit=2&after=d",
    ]);
  });

  it("list follows next_offset when sorted by wallet_used", async () => {
    const { client, calls } = mock(
      () => json({ workspaces: [ws("x"), ws("y")], next_offset: 2 }),
      () => json({ workspaces: [ws("z")] }),
    );
    const seen: string[] = [];
    for await (const w of client.partner.users.list({ sort: "wallet_used", limit: 2 })) seen.push(w.external_user_id);
    expect(seen).toEqual(["x", "y", "z"]);
    expect(calls[1]!.url).toBe("https://api.test/v1/partner/workspaces?sort=wallet_used&limit=2&offset=2");
  });

  it("breaking out of list stops before the next page is fetched", async () => {
    const { client, calls } = mock(
      () => json({ workspaces: [ws("a"), ws("b")], next_after: "b" }),
      () => json({ workspaces: [ws("c")] }),
    );
    for await (const w of client.partner.users.list({ limit: 2 })) {
      if (w.external_user_id === "a") break;
    }
    expect(calls).toHaveLength(1);
  });

  it("giveCredits generates a UUID key when none is given and returns it", async () => {
    const { client, calls } = mock(() => json(assigned));
    const r = await client.partner.users.giveCredits(id, { credits: 50 });
    expect(r.idempotency_key).toMatch(UUID_V4);
    expect(path(calls[0]!)).toBe(`POST /v1/partner/workspaces/${enc}/credits`);
    expect(body(calls[0]!)).toEqual({ credits: 50, idempotency_key: r.idempotency_key });
    expect(r.applied).toBe(true);
  });

  it("giveCredits sends a provided key verbatim and reports applied:false on a repeat", async () => {
    const { client, calls } = mock(() => json({ ...assigned, applied: false }));
    const r = await client.partner.users.giveCredits(id, { credits: 50, idempotency_key: "grant-0001-user42" });
    expect(body(calls[0]!)).toEqual({ credits: 50, idempotency_key: "grant-0001-user42" });
    expect(r.idempotency_key).toBe("grant-0001-user42");
    expect(r.applied).toBe(false);
  });

  it("giveCredits retries a 503 with the same key, so the credits move once", async () => {
    const { client, calls } = mock(
      () => problem(503, "ERR::INTERNAL::UNAVAILABLE", { retryable: true }),
      () => json(assigned),
    );
    const r = await client.partner.users.giveCredits(id, { credits: 50 });
    expect(calls).toHaveLength(2);
    const keys = calls.map((c) => body(c).idempotency_key);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[1]).toBe(r.idempotency_key);
  });

  it("giveCredits retries a timeout with the same key", async () => {
    const { client, calls } = mock(hang, () => json(assigned));
    const r = await client.partner.users.giveCredits(id, { credits: 50 }, { timeoutMs: 20 });
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => body(c).idempotency_key)).toEqual([r.idempotency_key, r.idempotency_key]);
  });

  it("giveCredits falls back to getRandomValues, and refuses without Web Crypto", async () => {
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => a.fill(0xab) });
    try {
      const { client, calls } = mock(() => json(assigned));
      const r = await client.partner.users.giveCredits(id, { credits: 1 });
      expect(r.idempotency_key).toMatch(UUID_V4);
      expect(body(calls[0]!).idempotency_key).toBe(r.idempotency_key);
    } finally {
      vi.unstubAllGlobals();
    }
    vi.stubGlobal("crypto", undefined);
    try {
      const { client, calls } = mock(() => json(assigned));
      await expect(client.partner.users.giveCredits(id, { credits: 1 })).rejects.toThrow(/idempotency_key/);
      expect(calls).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("PUT is retried like a GET: a 503 is retried, then succeeds", async () => {
    const { client, calls, sleeps } = mock(
      () => problem(503, "ERR::INTERNAL::UNAVAILABLE", { retryable: true, retry_after_seconds: 1 }),
      () => json({ ...ws(id), created: false, api_key: "k" }, 200),
    );
    await client.partner.users.create(id);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([1000]);
  });

  it("PATCH is not retried on a 503 or a timeout", async () => {
    const a = mock(() => problem(503, "ERR::INTERNAL::UNAVAILABLE", { retryable: true }));
    await expect(a.client.partner.users.update(id, { display_name: "x" })).rejects.toBeInstanceOf(InternalServerError);
    expect(a.calls).toHaveLength(1);
    const b = mock(hang);
    await expect(b.client.partner.users.update(id, { display_name: "x" }, { timeoutMs: 20 })).rejects.toBeInstanceOf(APITimeoutError);
    expect(b.calls).toHaveLength(1);
    const c = mock(connReset);
    await expect(c.client.partner.users.update(id, { display_name: "x" })).rejects.toBeInstanceOf(APIConnectionError);
    expect(c.calls).toHaveLength(1);
  });

  it("PATCH is retried on a 429, which is refused before any work", async () => {
    const { client, calls, sleeps } = mock(
      () => problem(429, "ERR::LIMIT::RATE_LIMITED", { retryable: true }, { "retry-after": "2" }),
      () => json(ws(id)),
    );
    await client.partner.users.update(id, { display_name: "x" });
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
  });

  it("402 on an over-balance assignment: class, code, detail, not retried", async () => {
    const { client, calls } = mock(() => problem(402, "ERR::LIMIT::QUOTA_EXCEEDED", { detail: "Only 880 credits can be given." }));
    const err = await client.partner.users.giveCredits(id, { credits: 9999 }).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientCreditsError);
    expect(err.code).toBe("ERR::LIMIT::QUOTA_EXCEEDED");
    expect(err.detail).toBe("Only 880 credits can be given.");
    expect(calls).toHaveLength(1);
  });

  it("409 on a reused key for another amount: class, code and detail pass through, not retried", async () => {
    const detail = "This idempotency_key was already used for a different assignment (another amount or user). Use a new key.";
    const { client, calls } = mock(() => problem(409, "ERR::REQUEST::CONFLICT", { detail }));
    const err = await client.partner.users.giveCredits(id, { credits: 7, idempotency_key: "grant-0001-user42" }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.code).toBe("ERR::REQUEST::CONFLICT");
    expect(err.detail).toBe(detail);
    expect(calls).toHaveLength(1);
  });

  it("429 PARTNER_WORKSPACE_LIMIT with Retry-After over 60 s is thrown, not slept", async () => {
    const { client, calls, sleeps } = mock(() =>
      problem(429, "ERR::LIMIT::PARTNER_WORKSPACE_LIMIT", { retryable: true, retry_after_seconds: 5400, detail: "Daily allowance used." }, { "retry-after": "5400" }),
    );
    const err = await client.partner.users.create("new-user").catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.code).toBe("ERR::LIMIT::PARTNER_WORKSPACE_LIMIT");
    expect(err.retryAfterSeconds).toBe(5400);
    expect(err.detail).toBe("Daily allowance used.");
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("a tier conflict (409) surfaces its detail", async () => {
    const { client } = mock(() => problem(409, "ERR::REQUEST::CONFLICT", { detail: "3 workspaces are on this tier." }));
    const err = await client.partner.tiers.delete("t1").catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.detail).toBe("3 workspaces are on this tier.");
  });

  it("ERROR_CODES lists the partner workspace limit", () => {
    expect(ERROR_CODES).toContain("ERR::LIMIT::PARTNER_WORKSPACE_LIMIT");
  });

  it("tiers: list, create, update and delete", async () => {
    const tier = { id: "t1", name: "Standard", requests_per_minute: 60, concurrency: 2, free_credits: 250, wallet_cap: 500, default: true, workspaces: 0, created_at: "2026-11-19T10:00:00Z", updated_at: "2026-11-19T10:00:00Z" };
    const { client, calls } = mock(
      () => json({ tiers: [tier] }),
      () => json(tier, 201),
      () => json({ ...tier, requests_per_minute: 120 }),
      () => new Response(null, { status: 204 }),
    );
    await client.partner.tiers.list();
    await client.partner.tiers.create({ name: "Standard", requests_per_minute: 60, concurrency: 2, free_credits: 250, wallet_cap: 500, default: true });
    const up = await client.partner.tiers.update("t 1", { requests_per_minute: 120 });
    const del = await client.partner.tiers.delete("t 1");
    expect(calls.map(path)).toEqual(["GET /v1/partner/tiers", "POST /v1/partner/tiers", "PATCH /v1/partner/tiers/t%201", "DELETE /v1/partner/tiers/t%201"]);
    expect(body(calls[1]!)).toMatchObject({ name: "Standard", wallet_cap: 500, default: true });
    expect(body(calls[2]!)).toEqual({ requests_per_minute: 120 });
    expect(up.requests_per_minute).toBe(120);
    expect(del._meta.status).toBe(204);
  });
});
