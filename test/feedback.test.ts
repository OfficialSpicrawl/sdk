import { describe, expect, it } from "vitest";
import { NotFoundError, RateLimitError, Spicrawl, SpicrawlError, type FeedbackParams } from "../src/index.js";

interface Call {
  url: string;
  init: RequestInit;
}

function mock(handler: () => Response) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler();
  };
  const client = new Spicrawl({ apiKey: "spicrawl_test_abc", baseURL: "https://api.test", fetch });
  client._transport.sleep = async () => {};
  return { client, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const problem = (status: number, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  json({ title: "t", status, code: "ERR::X::Y", detail: "it failed", retryable: false, ...extra }, status, {
    "content-type": "application/problem+json",
    ...headers,
  });

const caught = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as SpicrawlError;
  }
  throw new Error("expected a rejection");
};

const failing = (extra: Record<string, unknown>, headers: Record<string, string> = {}) =>
  caught(mock(() => problem(404, extra, headers)).client.key());

describe("error feedback fields", () => {
  it("a body with feedback_url is reportable", async () => {
    const err = await failing({ request_id: "req_1", feedback_url: "https://docs.test/feedback" });
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.feedbackUrl).toBe("https://docs.test/feedback");
    expect(err.isReportable).toBe(true);
    expect(err.requestId).toBe("req_1");
  });

  it("a body without feedback_url is not reportable", async () => {
    const err = await failing({ request_id: "req_1" });
    expect(err.feedbackUrl).toBeUndefined();
    expect(err.isReportable).toBe(false);
  });

  it("a non-string feedback_url is ignored", async () => {
    const err = await failing({ feedback_url: 42 });
    expect(err.feedbackUrl).toBeUndefined();
    expect(err.isReportable).toBe(false);
  });

  it("requestId falls back to the X-Request-Id header", async () => {
    const err = await failing({}, { "x-request-id": "req_header" });
    expect(err.requestId).toBe("req_header");
  });

  it("the body's request_id wins over the header", async () => {
    const err = await failing({ request_id: "req_body" }, { "x-request-id": "req_header" });
    expect(err.requestId).toBe("req_body");
  });

  it("no id anywhere leaves requestId undefined", async () => {
    expect((await failing({})).requestId).toBeUndefined();
  });

  it("a non-problem body (a gateway page) still takes the header id", async () => {
    const { client } = mock(() => new Response("bad gateway", { status: 502, headers: { "x-request-id": "req_gw" } }));
    const err = await caught(client.key());
    expect(err.requestId).toBe("req_gw");
    expect(err.isReportable).toBe(false);
  });
});

describe("feedback()", () => {
  const created = { feedback_id: "fb_1", already_submitted: false, credits_refunded: 3, refund_cap_reached: false };

  it("posts to /v1/feedback with rating down by default and only the fields given", async () => {
    const { client, calls } = mock(() => json(created, 201));
    await client.feedback({ requestId: "req_1" });
    expect(calls[0]!.url).toBe("https://api.test/v1/feedback");
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ request_id: "req_1", rating: "down" });
  });

  it("maps camelCase params to snake_case and keeps an explicit rating", async () => {
    const { client, calls } = mock(() => json(created, 201));
    const params: FeedbackParams = {
      requestId: "req_1",
      rating: "up",
      kind: "wrong_result",
      impact: "worked_around",
      intent: "the prices",
      comment: "got the footer",
      agent: "my-agent/1.2",
    };
    await client.feedback(params);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      request_id: "req_1",
      rating: "up",
      kind: "wrong_result",
      impact: "worked_around",
      intent: "the prices",
      comment: "got the footer",
      agent: "my-agent/1.2",
    });
  });

  it("maps a created result to camelCase and carries the response meta", async () => {
    const { client } = mock(() => json(created, 201, { "x-request-id": "req_fb" }));
    const r = await client.feedback({ requestId: "req_1" });
    expect(r).toEqual({ feedbackId: "fb_1", alreadySubmitted: false, creditsRefunded: 3, refundCapReached: false });
    expect(r._meta.requestId).toBe("req_fb");
  });

  it("maps alreadySubmitted from a 200", async () => {
    const { client } = mock(() => json({ ...created, already_submitted: true, credits_refunded: 0 }, 200));
    const r = await client.feedback({ requestId: "req_1" });
    expect(r.alreadySubmitted).toBe(true);
    expect(r.creditsRefunded).toBe(0);
  });

  it("maps refundCapReached", async () => {
    const { client } = mock(() => json({ ...created, credits_refunded: 0, refund_cap_reached: true }, 201));
    const r = await client.feedback({ requestId: "req_1" });
    expect(r.refundCapReached).toBe(true);
    expect(r.creditsRefunded).toBe(0);
  });

  it("a 404 throws NotFoundError with its request id", async () => {
    const { client } = mock(() => problem(404, { request_id: "req_fb404" }));
    const err = await caught(client.feedback({ requestId: "nope" }));
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.requestId).toBe("req_fb404");
  });

  it("a 429 throws RateLimitError", async () => {
    const { client } = mock(() => problem(429, { retryable: false }));
    expect(await caught(client.feedback({ requestId: "req_1" }))).toBeInstanceOf(RateLimitError);
  });
});
