import { chatJson } from "./ai";
import type { Risk } from "./types";

export interface ReviewInput {
  id: string;
  type: string;
  fullName: string;
  status: string;
  sourceDef?: string;
  targetDef?: string;
  ruleRisk: Risk;
  ruleNote: string;
}

export interface ReviewOutput {
  id: string;
  risk: Risk;
  isNoise: boolean;
  note: string;
}

const SYSTEM = `You are a senior database engineer reviewing schema differences between two environments before a release.
"source" is the reference environment (e.g. DEV). "target" is the environment being checked (e.g. SIT).
Status meanings: MISSING = exists only in source; EXTRA = exists only in target; DIFF = exists in both with different definitions (for DIFF you get a unified diff where + lines are the source version).
For each item decide:
- isNoise: true if the object looks like a backup, temporary, test, dated copy or experimental object that should NOT be promoted (e.g. names with dates, _bak, _old, _copy, temp/staging tables, _Copilot, _test).
- risk of making the target match the source: "High" (can break callers, lose data, fail on existing rows, change a signature), "Medium" (logic change worth reviewing), "Low" (safe/additive/cosmetic), or "Noise".
- note: one plain-English sentence (max 25 words) saying what changed and what to do. Be specific to the code.
A rule-based risk and note are given as a hint; override them when the code says otherwise.
Return JSON: {"items": [{"id": string, "risk": "High"|"Medium"|"Low"|"Noise", "isNoise": boolean, "note": string}]} with one entry per input id.`;

export async function reviewWithAi(items: ReviewInput[]): Promise<ReviewOutput[]> {
  const r = await chatJson<{ items: ReviewOutput[] }>(SYSTEM, JSON.stringify({ items }), 6000);
  const valid: Risk[] = ["High", "Medium", "Low", "Noise"];
  const ids = new Set(items.map((i) => i.id));
  return (r.items || [])
    .filter((x) => x && ids.has(x.id))
    .map((x) => {
      const isNoise = !!x.isNoise || x.risk === "Noise";
      return {
        id: x.id,
        isNoise,
        risk: isNoise ? "Noise" : valid.includes(x.risk) ? x.risk : "Medium",
        note: String(x.note || "").slice(0, 300),
      };
    });
}
