import { createTwoFilesPatch } from "diff";
import type { ReviewInput, ReviewOutput } from "./aiReview";
import { summarize } from "./compare";
import type { CompareResult, DiffItem } from "./types";

const MAX_CHARS = 2500;

/** Keep the AI prompt small: only the changed hunks for DIFF items, the start of the code for MISSING / EXTRA. */
export function toReviewInputClient(it: DiffItem): ReviewInput {
  let sourceDef: string | undefined;
  let targetDef: string | undefined;
  if (it.status === "DIFF" && it.sourceDef != null && it.targetDef != null) {
    const patch = createTwoFilesPatch("target", "source", it.targetDef, it.sourceDef, "", "", { context: 2 });
    sourceDef = patch.split("\n").slice(4).join("\n").slice(0, MAX_CHARS);
  } else {
    sourceDef = it.sourceDef?.slice(0, 800);
    targetDef = it.targetDef?.slice(0, 800);
  }
  return { id: it.id, type: it.type, fullName: it.fullName, status: it.status, sourceDef, targetDef, ruleRisk: it.risk, ruleNote: it.note };
}

export function mergeReviews(result: CompareResult, reviews: ReviewOutput[]): CompareResult {
  const byId = new Map(reviews.map((r) => [r.id, r]));
  const items = result.items.map((it) => {
    const r = byId.get(it.id);
    if (!r) return it;
    return { ...it, risk: r.risk, noise: r.isNoise, note: r.note || it.note, aiReviewed: true };
  });
  return { ...result, items, summary: summarize(items) };
}
