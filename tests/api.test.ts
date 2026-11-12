import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { snap, proc } from "./helpers";

const m = vi.hoisted(() => ({ takeSnapshot: vi.fn(), testConnection: vi.fn(), reviewWithAi: vi.fn() }));
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), takeSnapshot: m.takeSnapshot, testConnection: m.testConnection }));
vi.mock("@/lib/aiReview", () => ({ reviewWithAi: m.reviewWithAi }));

import { POST as compare } from "@/app/api/compare/route";
import { POST as convert } from "@/app/api/convert/route";
import { POST as review } from "@/app/api/ai/review/route";
import { GET as status } from "@/app/api/ai/status/route";
import { POST as testConn } from "@/app/api/test-connection/route";

const post = (body: unknown) => new Request("http://test/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const src = { engine: "sqlserver", label: "DEV", host: "h", database: "d", user: "u", password: "p" };
const tgt = { ...src, label: "SIT" };

beforeEach(() => {
  delete process.env.AI_PROVIDER;
});
afterEach(() => {
  delete process.env.AI_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  Object.values(m).forEach((f) => f.mockReset());
});

describe("POST /api/compare", () => {
  it("returns demo results without a database", async () => {
    const res = await compare(post({ demo: true, options: {} }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source.label).toBe("DEV (demo)");
    expect(body.summary.total).toBeGreaterThan(0);
    expect(body.options.groups.length).toBeGreaterThan(0);
  });

  it("validates connections", async () => {
    const res = await compare(post({ source: { ...src, host: "" }, target: tgt, options: {} }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Source: server/);
  });

  it("snapshots both databases and compares", async () => {
    m.takeSnapshot.mockImplementation(async (c: { label: string }) => snap(c.label === "DEV" ? [proc("p", "SELECT 1")] : [], c.label));
    const res = await compare(post({ source: src, target: tgt, options: { groups: ["procedures"], ignoreWhitespace: true, ignoreCase: true } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(m.takeSnapshot).toHaveBeenCalledTimes(2);
    expect([...m.takeSnapshot.mock.calls[0][1]]).toEqual(["StoredProcedure"]);
    expect(body.items).toHaveLength(1);
  });

  it("returns 502 with friendly messages when a database fails", async () => {
    m.takeSnapshot.mockImplementation(async (c: { label: string }) => {
      if (c.label === "SIT") throw new Error("Login failed for user 'u'");
      return snap([]);
    });
    const res = await compare(post({ source: src, target: tgt, options: {} }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("SIT: login failed. Check username and password.");
  });
});

describe("POST /api/test-connection", () => {
  it("rejects incomplete input", async () => {
    const res = await testConn(post({ connection: { ...src, user: "" } }));
    expect(res.status).toBe(400);
  });
  it("returns the driver result", async () => {
    m.testConnection.mockResolvedValue({ ok: true, version: "v", database: "d", canViewDefinition: true });
    expect(await (await testConn(post({ connection: src }))).json()).toMatchObject({ ok: true, database: "d" });
  });
  it("returns ok:false with a friendly error", async () => {
    m.testConnection.mockRejectedValue(new Error("connect ETIMEDOUT"));
    const body = await (await testConn(post({ connection: src }))).json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/timeout/);
  });
});

describe("POST /api/convert", () => {
  it("converts SQL", async () => {
    const res = await convert(post({ sql: "SELECT GETDATE() FROM t", from: "sqlserver", to: "oracle" }));
    expect((await res.json()).sql).toBe("SELECT SYSDATE FROM t");
  });
  it("rejects empty and oversized SQL", async () => {
    expect((await convert(post({ sql: "  ", from: "sqlserver", to: "oracle" }))).status).toBe(400);
    expect((await convert(post({ sql: "x".repeat(200_001), from: "sqlserver", to: "oracle" }))).status).toBe(400);
  });
});

describe("AI routes", () => {
  it("GET /api/ai/status reports configuration", async () => {
    expect(await (await status()).json()).toEqual({ enabled: false, provider: "none", model: "" });
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "k";
    expect(await (await status()).json()).toMatchObject({ enabled: true, provider: "openai" });
  });

  it("POST /api/ai/review refuses when AI is off", async () => {
    expect((await review(post({ items: [{ id: "a" }] }))).status).toBe(400);
  });

  it("POST /api/ai/review limits batches to 30 and returns results", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "k";
    m.reviewWithAi.mockResolvedValue([{ id: "a", risk: "Low", isNoise: false, note: "n" }]);
    const items = Array.from({ length: 40 }, (_, i) => ({ id: String(i) }));
    const body = await (await review(post({ items }))).json();
    expect(m.reviewWithAi.mock.calls[0][0]).toHaveLength(30);
    expect(body.items).toHaveLength(1);
  });

  it("POST /api/ai/review handles empty input and AI errors", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "k";
    expect(await (await review(post({ items: [] }))).json()).toEqual({ items: [] });
    m.reviewWithAi.mockRejectedValue(new Error("quota"));
    const res = await review(post({ items: [{ id: "a" }] }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("quota");
  });
});
