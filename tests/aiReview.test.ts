import { describe, expect, it, vi } from "vitest";
import { compareSnapshots } from "@/lib/compare";
import { mergeReviews, toReviewInputClient } from "@/lib/reviewClient";
import { item, opts, proc, snap } from "./helpers";

const { chatJson } = vi.hoisted(() => ({ chatJson: vi.fn() }));
vi.mock("@/lib/ai", () => ({ chatJson: (...a: unknown[]) => chatJson(...a) }));
import { reviewWithAi } from "@/lib/aiReview";

describe("toReviewInputClient – keeps prompts small", () => {
  it("sends only a unified diff for DIFF items", () => {
    const r = toReviewInputClient(item({ status: "DIFF", sourceDef: "a\nb\nNEW\nc", targetDef: "a\nb\nc" }));
    expect(r.sourceDef).toContain("+NEW");
    expect(r.targetDef).toBeUndefined();
  });
  it("truncates long MISSING / EXTRA definitions", () => {
    const r = toReviewInputClient(item({ sourceDef: "x".repeat(5000) }));
    expect(r.sourceDef!.length).toBe(800);
  });
  it("passes rule-based risk and note as hints", () => {
    expect(toReviewInputClient(item({ risk: "High", note: "n" }))).toMatchObject({ ruleRisk: "High", ruleNote: "n" });
  });
});

describe("reviewWithAi", () => {
  it("returns cleaned results for known ids only", async () => {
    chatJson.mockResolvedValue({
      items: [
        { id: "a", risk: "High", isNoise: false, note: "Signature changed" },
        { id: "b", risk: "Weird", isNoise: false, note: "x" },
        { id: "c", risk: "Low", isNoise: true, note: "backup" },
        { id: "zzz", risk: "Low", note: "unknown id" },
        null,
      ],
    });
    const out = await reviewWithAi(["a", "b", "c"].map((id) => ({ id, type: "View", fullName: id, status: "DIFF", ruleRisk: "Low" as const, ruleNote: "" })));
    expect(out).toEqual([
      { id: "a", risk: "High", isNoise: false, note: "Signature changed" },
      { id: "b", risk: "Medium", isNoise: false, note: "x" },
      { id: "c", risk: "Noise", isNoise: true, note: "backup" },
    ]);
    expect(chatJson.mock.calls[0][0]).toMatch(/isNoise/);
  });
  it("handles a reply without items", async () => {
    chatJson.mockResolvedValue({});
    expect(await reviewWithAi([])).toEqual([]);
  });
});

describe("mergeReviews", () => {
  it("applies AI results and recomputes the summary", () => {
    const r = compareSnapshots(snap([proc("a", "SELECT 1"), proc("b", "SELECT 1")]), snap([], "SIT"), opts());
    const id = r.items[0].id;
    const merged = mergeReviews(r, [{ id, risk: "Noise", isNoise: true, note: "AI says backup" }]);
    expect(merged.items[0]).toMatchObject({ risk: "Noise", noise: true, note: "AI says backup", aiReviewed: true });
    expect(merged.items[1].aiReviewed).toBeUndefined();
    expect(merged.summary.noise).toBe(1);
    expect(r.summary.noise).toBe(0); // original untouched
  });
  it("keeps the rule note when the AI note is empty", () => {
    const r = compareSnapshots(snap([proc("a", "SELECT 1")]), snap([], "SIT"), opts());
    expect(mergeReviews(r, [{ id: r.items[0].id, risk: "Low", isNoise: false, note: "" }]).items[0].note).toBe(r.items[0].note);
  });
});
