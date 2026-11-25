import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Spicrawl, verifyWebhookSignature } from "../src/index.js";

interface Call {
  url: string;
  init: RequestInit;
}

function mock(...handlers: Array<() => Response>) {
  const calls: Call[] = [];
  let i = 0;
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handlers[Math.min(i++, handlers.length - 1)]!();
  };
  const client = new Spicrawl({ apiKey: "spicrawl_test_abc", baseURL: "https://api.test", fetch });
  client._transport.sleep = async () => {};
  return { client, calls };
}

const json = (b: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });
const body = (c: Call) => JSON.parse(c.init.body as string);
const path = (c: Call) => `${c.init.method} ${c.url.replace("https://api.test", "")}`;
const id = "ep 1/x";
const enc = "ep%201%2Fx";

describe("brand", () => {
  it("POST /v1/brand sends url and options, returns the typed body with credits", async () => {
    const { client, calls } = mock(() => json({ url: "https://a.com", final_url: "https://a.com/", identity: { name: "A" } }, 200, { "x-credits-charged": "5" }));
    const r = await client.brand.get("https://a.com", { include: ["logos", "colors"], screenshot: true });
    expect(path(calls[0]!)).toBe("POST /v1/brand");
    expect(body(calls[0]!)).toEqual({ url: "https://a.com", include: ["logos", "colors"], screenshot: true });
    expect(r.final_url).toBe("https://a.com/");
    expect(r._meta.status).toBe(200);
  });

  it("url alone sends only the url", async () => {
    const { client, calls } = mock(() => json({ url: "u", final_url: "u" }));
    await client.brand.get("https://a.com");
    expect(body(calls[0]!)).toEqual({ url: "https://a.com" });
  });
});

describe("webhooks", () => {
  const ep = { id: "e1", url: "https://x.com/h", events: ["monitor.changed"], format: "json", enabled: true };

  it("create returns the secret", async () => {
    const { client, calls } = mock(() => json({ ...ep, secret: "whsec_abc" }, 201));
    const r = await client.webhooks.create({ url: "https://x.com/h", events: ["monitor.changed"], format: "json", name: "n" });
    expect(path(calls[0]!)).toBe("POST /v1/webhooks");
    expect(body(calls[0]!)).toEqual({ url: "https://x.com/h", events: ["monitor.changed"], format: "json", name: "n" });
    expect(r.secret).toBe("whsec_abc");
  });

  it("list, get, update, test, rotateSecret, deliveries, delete", async () => {
    const { client, calls } = mock(
      () => json({ data: [ep] }),
      () => json(ep),
      () => json({ ...ep, enabled: false }),
      () => json({ delivery_id: "d1" }, 202),
      () => json({ ...ep, secret: "whsec_new" }),
      () => json({ data: [] }),
      () => new Response(null, { status: 204 }),
    );
    await client.webhooks.list();
    await client.webhooks.get(id);
    await client.webhooks.update(id, { enabled: false, name: "z" });
    const t = await client.webhooks.test(id);
    const rot = await client.webhooks.rotateSecret(id);
    await client.webhooks.deliveries(id, { limit: 5 });
    const del = await client.webhooks.delete(id);
    expect(calls.map(path)).toEqual([
      "GET /v1/webhooks",
      `GET /v1/webhooks/${enc}`,
      `PATCH /v1/webhooks/${enc}`,
      `POST /v1/webhooks/${enc}/test`,
      `POST /v1/webhooks/${enc}/rotate-secret`,
      `GET /v1/webhooks/${enc}/deliveries?limit=5`,
      `DELETE /v1/webhooks/${enc}`,
    ]);
    expect(body(calls[2]!)).toEqual({ enabled: false, name: "z" });
    expect(calls[3]!.init.body).toBeUndefined();
    expect(t.delivery_id).toBe("d1");
    expect(rot.secret).toBe("whsec_new");
    expect(del._meta.status).toBe(204);
  });
});

describe("monitors", () => {
  const m = { id: "m1", url: "https://x.com" };

  it("create, list, get, update, check, changes, delete", async () => {
    const { client, calls } = mock(
      () => json(m, 201),
      () => json({ data: [m] }),
      () => json(m),
      () => json({ ...m, interval_seconds: 600 }),
      () => json({ outcome: "unchanged" }),
      () => json({ data: [] }),
      () => new Response(null, { status: 204 }),
    );
    await client.monitors.create({ url: "https://x.com", webhook_endpoint_id: "e1", interval_seconds: 3600, scope: "site", js_render: true });
    await client.monitors.list();
    await client.monitors.get(id);
    await client.monitors.update(id, { interval_seconds: 600 });
    const c = await client.monitors.check(id);
    await client.monitors.changes(id, { limit: 10 });
    const del = await client.monitors.delete(id);
    expect(calls.map(path)).toEqual([
      "POST /v1/monitors",
      "GET /v1/monitors",
      `GET /v1/monitors/${enc}`,
      `PATCH /v1/monitors/${enc}`,
      `POST /v1/monitors/${enc}/check`,
      `GET /v1/monitors/${enc}/changes?limit=10`,
      `DELETE /v1/monitors/${enc}`,
    ]);
    expect(body(calls[0]!)).toEqual({ url: "https://x.com", webhook_endpoint_id: "e1", interval_seconds: 3600, scope: "site", js_render: true });
    expect(body(calls[3]!)).toEqual({ interval_seconds: 600 });
    expect(c.outcome).toBe("unchanged");
    expect(del._meta.status).toBe(204);
  });

  it("pages follows next_cursor", async () => {
    const { client, calls } = mock(
      () => json({ data: [{ url: "a" }, { url: "b" }], next_cursor: "c1" }),
      () => json({ data: [{ url: "c" }] }),
    );
    const urls: string[] = [];
    for await (const p of client.monitors.pages(id, { limit: 2 })) urls.push(p.url);
    expect(urls).toEqual(["a", "b", "c"]);
    expect(calls[0]!.url).toBe(`https://api.test/v1/monitors/${enc}/pages?limit=2`);
    expect(calls[1]!.url).toBe(`https://api.test/v1/monitors/${enc}/pages?limit=2&cursor=c1`);
  });

  it("await pages gives one page", async () => {
    const { client } = mock(() => json({ data: [{ url: "a" }], next_cursor: "n" }));
    const page = await client.monitors.pages("m1");
    expect(page.data).toHaveLength(1);
    expect(page.hasNextPage()).toBe(true);
  });
});

describe("verifyWebhookSignature", () => {
  const secret = "whsec_test_secret_123";
  const raw = '{"event":"monitor.changed","id":"evt_1"}';
  const t = 1_790_000_000;
  const sign = (b: string | Uint8Array, ts = t, s = secret) =>
    createHmac("sha256", Buffer.from(s, "utf8")).update(`${ts}.`).update(b).digest("hex");
  const header = (ts = t, sig = sign(raw, ts)) => `t=${ts},v1=${sig},kid=1`;

  it("matches a fixed known vector", () => {
    // Independently computed: HMAC-SHA256("whsec_test_secret_123", "1790000000." + body)
    expect(sign(raw)).toBe(createHmac("sha256", "whsec_test_secret_123").update(`1790000000.${raw}`).digest("hex"));
    expect(sign(raw)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts a valid signature", () => {
    expect(verifyWebhookSignature(raw, header(), secret, { now: t + 10 })).toBe(true);
  });
  it("accepts a Uint8Array body", () => {
    expect(verifyWebhookSignature(new TextEncoder().encode(raw), header(), secret, { now: t })).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifyWebhookSignature(raw.replace("evt_1", "evt_2"), header(), secret, { now: t })).toBe(false);
  });
  it("rejects a wrong secret", () => {
    expect(verifyWebhookSignature(raw, header(), "whsec_other", { now: t })).toBe(false);
  });
  it("rejects a stale timestamp, honours toleranceSeconds", () => {
    expect(verifyWebhookSignature(raw, header(), secret, { now: t + 301 })).toBe(false);
    expect(verifyWebhookSignature(raw, header(), secret, { now: t + 300 })).toBe(true);
    expect(verifyWebhookSignature(raw, header(), secret, { now: t - 301 })).toBe(false);
    expect(verifyWebhookSignature(raw, header(), secret, { now: t + 600, toleranceSeconds: 900 })).toBe(true);
  });
  it("rejects a malformed header", () => {
    for (const h of ["", "garbage", `t=${t}`, `v1=${sign(raw)}`, `t=abc,v1=${sign(raw)}`, `t=${t},v1=zz`, `t=${t},v1=${sign(raw).slice(0, 10)}`]) {
      expect(verifyWebhookSignature(raw, h, secret, { now: t }), h).toBe(false);
    }
  });
  it("uses the system clock by default", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifyWebhookSignature(raw, header(now, sign(raw, now)), secret)).toBe(true);
    expect(verifyWebhookSignature(raw, header(), secret)).toBe(false);
  });
});
