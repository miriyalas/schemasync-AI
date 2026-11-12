import { describe, expect, it } from "vitest";
import { runSelfTest } from "@/lib/selfTest";
import { GET } from "@/app/api/self-test/route";

describe("live self-check", () => {
  it("every check passes on a healthy build", async () => {
    const r = await runSelfTest();
    const failed = r.checks.filter((c) => !c.pass);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(20);
  });

  it("covers every area and reports environment info", async () => {
    const r = await runSelfTest();
    expect(new Set(r.checks.map((c) => c.area))).toEqual(new Set(["Compare", "Risk & noise", "Converter", "Deploy script", "Environment"]));
    expect(r.checks.find((c) => c.id === "E1")!.info).toBe(true);
    expect(r.checks.every((c) => typeof c.ms === "number")).toBe(true);
  });

  it("GET /api/self-test returns the results as JSON", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).failed).toBe(0);
  });
});
