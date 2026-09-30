import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APIConnectionError,
  APITimeoutError,
  AuthenticationError,
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
        "x-engine": "obscura",
        "x-request-id": "01ABC",
        "x-credits-charged": "3",
        "x-credits-remaining": "997",
        "x-request-cost": "3",
        "x-ratelimit-limit": "100",
        "x-ratelimit-remaining": "99",
        "x-ratelimit-reset": "30",
        "cache-state": "miss",
        "x-target-status": "200",
        "x-warning": "ESCALATED: moved to obscura",
      }),
    );
    const r = await client.scrape({ url: "https://example.com" });
    expect(r._meta).toMatchObject({
      requestId: "01ABC",
      creditsCharged: 3,
      creditsRemaining: 997,
      engine: "obscura",
      cacheState: "miss",
      targetStatus: 200,
      rateLimit: { limit: 100, remaining: 99, reset: 30 },
      warnings: ["ESCALATED: moved to obscura"],
    });
    expect(Object.keys(r)).not.toContain("_meta");
    expect(JSON.parse(JSON.stringify(r))).toEqual(envelope);
  });

  it("per-request headers are sent", async () => {
    const { client, calls } = mock(() => json({ sessions: [] }));
    await client.sessions.list({}, { headers: { "X-Trace": "1" } });
    expect((calls[0]!.init.headers as Record<string, string>)["X-Trace"]).toBe("1");
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
    const r = await client.scrapeRaw({ url: "https://e", response_format: "pdf", engine: "chromium" });
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
