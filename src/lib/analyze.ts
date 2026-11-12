import type { ColumnMeta, DiffItem, Risk } from "./types";

/**
 * Rule-based checks that run without any AI.
 * Risk = how risky it is to make the target match the source for this item.
 */

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
const NOISE_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: new RegExp(`\\d{1,2}(st|nd|rd|th)?[_-]?(${MONTHS})[a-z]*[_-]?\\d{2,4}`, "i"), reason: "Dated name: looks like a backup copy" },
  { re: new RegExp(`(?<![a-z])(${MONTHS})[a-z]*[_-]?\\d{1,2}[_-]?\\d{4}`, "i"), reason: "Dated name: looks like a backup copy" },
  { re: /(^|_)(19|20)\d{2}[-_]?(0[1-9]|1[0-2])[-_]?(0[1-9]|[12]\d|3[01])($|_)/, reason: "Date stamp in name: looks like a backup copy" },
  { re: /(^|_)(bak|bkp|backup|old|copy|orig|archive|archived|todelete|del|dummy|junk)\d*$/i, reason: "Backup / old copy suffix" },
  { re: /(^|_)(test|tst|demo|poc|trial)\d*$|^(test|tst)_/i, reason: "Test / demo object" },
  { re: /copilot|chatgpt|_ai_test|_scratch|_draft/i, reason: "Experimental / AI-generated draft" },
  { re: /(^|_)(temp|tmp)(?!late|erat|or)/i, reason: "Temporary / staging object" },
];

export function noiseReason(name: string): string | null {
  for (const p of NOISE_PATTERNS) if (p.re.test(name)) return p.reason;
  return null;
}

function signature(def: string): string {
  // Everything before the first standalone AS = parameter list / RETURNS clause.
  const t = def
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/[\[\]"]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
  const m = t.search(/\b(as|is)\b/);
  return (m > 0 ? t.slice(0, m) : t).replace(/\bcreate\s+or\s+(alter|replace)\b/, "create").replace(/\bproc\b/, "procedure").trim();
}

export function analyzeItem(item: DiffItem, childCount = 0): Pick<DiffItem, "risk" | "note" | "noise"> {
  const noise = noiseReason(item.name) || (item.parent ? noiseReason(item.parent) : null);
  if (noise) return { risk: "Noise", noise: true, note: `${noise}. Probably skip.` };

  const r = (risk: Risk, note: string) => ({ risk, note, noise: false });
  const meta = (item.meta || {}) as Record<string, unknown>;

  if (item.status === "MISSING") {
    switch (item.type) {
      case "Table":
        return r("Low", `New table${childCount ? ` (${childCount} columns)` : ""}. Create it in the target.`);
      case "Column": {
        const c = meta as unknown as ColumnMeta;
        if (!c.nullable && !c.defaultValue && !c.identity && !c.computed)
          return r("High", "NOT NULL with no default: adding it fails if the table already has rows.");
        return r("Low", "Add this column to the target table.");
      }
      case "TableType":
        return r("Medium", "Create it before the procedures that use it.");
      case "PrimaryKey":
      case "UniqueConstraint":
        return r("Medium", "Fails if the target has duplicate or NULL values in these columns.");
      case "ForeignKey":
        return r("Medium", "Existing rows in the target must satisfy this key.");
      case "CheckConstraint":
        return r("Medium", "Existing rows in the target must pass this check.");
      case "Index":
        return r("Low", "Add the index. On big tables, build it outside business hours.");
      default:
        return r("Low", "New object. Create it in the target.");
    }
  }

  if (item.status === "EXTRA") {
    if (item.type === "Table" || item.type === "Column")
      return r("High", "Only in the target. Dropping it would lose data: review, do not auto-drop.");
    return r("Medium", "Only in the target. Decide whether to remove it or add it to the source.");
  }

  // DIFF
  switch (item.type) {
    case "Column": {
      const s = (item.sourceDef || "").toLowerCase();
      const t = (item.targetDef || "").toLowerCase();
      const typeOf = (d: string) => d.split(/\s+(null|not null)\b/)[0];
      if (typeOf(s) !== typeOf(t)) return r("High", `Data type changes: ${typeOf(t)} → ${typeOf(s)}.`);
      if (/not null/.test(s) && !/not null/.test(t)) return r("High", "Becomes NOT NULL: fails if the target has NULLs.");
      return r("Medium", "Default, identity or nullability differs.");
    }
    case "StoredProcedure":
    case "Function":
      if (item.sourceDef && item.targetDef && signature(item.sourceDef) !== signature(item.targetDef))
        return r("High", "Parameters / signature changed: callers in the target may break.");
      return r("Medium", `Body changed (+${item.added} / −${item.removed} lines). Review the logic.`);
    case "View":
      return r("Medium", "View definition changed: check reports and code that read it.");
    case "Trigger":
      return r("Medium", "Trigger logic changed: affects every write to the table.");
    case "TableType":
    case "TableTypeColumn":
      return r("High", "Table type changed: it must be dropped and recreated with its dependent procedures.");
    case "PrimaryKey":
    case "UniqueConstraint":
    case "ForeignKey":
    case "CheckConstraint":
      return r("Medium", "Constraint definition differs.");
    case "Index":
      return r("Low", "Index definition differs (performance only).");
    default:
      return r("Low", "Definition differs.");
  }
}
