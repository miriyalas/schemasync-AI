import { aiConfig, chatJson } from "../ai";
import type { ConvertChange, ConvertResult, Engine } from "../types";
import { ChangeLog, basicValidation, protect } from "./helpers";
import { ORACLE_PROCEDURAL, oracleToTsql } from "./oracleToTsql";
import { TSQL_PROCEDURAL, tsqlToOracle } from "./tsqlToOracle";

const NAMES: Record<Engine, string> = { sqlserver: "SQL Server T-SQL", oracle: "Oracle PL/SQL" };

const IDIOMS: Record<Engine, string> = {
  oracle:
    "Target idioms: procedure result sets → an OUT SYS_REFCURSOR parameter opened with OPEN … FOR; TRY/CATCH + THROW → EXCEPTION WHEN OTHERS THEN RAISE; @params → p_ prefixed IN/OUT parameters; local @variables → v_ prefixed variables declared before BEGIN; SELECT @v = col → SELECT col INTO v_v; #temp tables → global temporary tables or CTEs; IF EXISTS(…) → SELECT COUNT(*) INTO …; SCOPE_IDENTITY() → RETURNING … INTO; every statement ends with a semicolon.",
  sqlserver:
    "Target idioms: OUT SYS_REFCURSOR → return a result set with SELECT; EXCEPTION blocks → BEGIN TRY / BEGIN CATCH with THROW; p_ parameters → @parameters; v_ variables → DECLARE @variables; SELECT … INTO v → SELECT @v = …; %TYPE / %ROWTYPE → explicit types; seq.NEXTVAL → NEXT VALUE FOR seq; packages → separate procedures/functions (explain in warnings); use CREATE OR ALTER.",
};

interface AiConversion {
  sql: string;
  changes?: { from: string; to: string }[];
  warnings?: string[];
  confidence?: "High" | "Medium" | "Low";
}

export async function convertSql(sql: string, from: Engine, to: Engine, useAI: boolean): Promise<ConvertResult> {
  if (from === to) {
    return {
      sql,
      from,
      to,
      changes: [],
      warnings: ["Source and target dialect are the same: nothing to convert."],
      confidence: "High",
      usedAI: false,
      procedural: false,
      validation: basicValidation(sql),
    };
  }

  const p = protect(sql, "strip");
  const log = new ChangeLog();
  const procedural = (from === "sqlserver" ? TSQL_PROCEDURAL : ORACLE_PROCEDURAL).test(p.text);
  const converted = from === "sqlserver" ? tsqlToOracle(p.text, log, procedural) : oracleToTsql(p.text, log, procedural);
  const draft = p.restore(converted);
  if (/\[[^\]]+\]|"[^"]+"/.test(sql)) log.add("[name] / \"name\"", "name (quotes removed)");
  if (to === "oracle" && /\bNVL\s*\([^()]*,\s*''\s*\)/i.test(draft))
    log.warn("Oracle treats '' as NULL, so NVL(x, '') has no effect. Check any empty-string logic.");

  let finalSql = draft;
  let changes: ConvertChange[] = [...log.changes];
  let warnings = [...log.warnings];
  let confidence: ConvertResult["confidence"] = procedural ? "Low" : warnings.length ? "Medium" : "High";
  let usedAI = false;

  if (procedural && useAI && aiConfig().enabled) {
    try {
      const system = `You are an expert database migration engineer fluent in Microsoft SQL Server T-SQL and Oracle PL/SQL.
Convert the user's ${NAMES[from]} code to ${NAMES[to]}.
- Keep the business logic exactly the same. Keep object, table and column names.
- A rule-based draft is provided: start from it and finish what the rules could not (procedural code, variables, error handling, result sets, temp tables).
- ${IDIOMS[to]}
- List each meaningful change you made beyond the draft as {"from","to"} pairs (short code fragments, not sentences).
- Add a warning for anything that can change behaviour: NULL vs empty string, transactions, date/time precision, case sensitivity, callers that must change.
Return JSON: {"sql": string, "changes": [{"from": string, "to": string}], "warnings": [string], "confidence": "High" | "Medium" | "Low"}`;
      const user = `Original (${NAMES[from]}):\n\`\`\`sql\n${sql}\n\`\`\`\n\nRule-based draft (${NAMES[to]}):\n\`\`\`sql\n${draft}\n\`\`\``;
      const r = await chatJson<AiConversion>(system, user, 8000);
      if (r.sql && r.sql.trim()) {
        finalSql = r.sql.replace(/^```(?:sql)?\s*/i, "").replace(/```\s*$/, "").trim();
        changes = [...changes, ...(r.changes || []).map((c) => ({ from: String(c.from), to: String(c.to), by: "AI" as const }))];
        warnings = [...warnings, ...(r.warnings || []).map(String)];
        confidence = r.confidence || "Medium";
        usedAI = true;
      }
    } catch (e) {
      warnings.push(`AI step failed: ${(e as Error).message}. Showing the rule-based draft.`);
    }
  } else if (procedural) {
    warnings.unshift(
      useAI && !aiConfig().enabled
        ? "Procedural code detected, but AI is not configured. Rules converted functions and data types only: finish variables, error handling and result sets by hand."
        : "Procedural code detected. Rules converted functions and data types only: turn on AI to finish the conversion."
    );
  }

  return { sql: finalSql, from, to, changes, warnings, confidence, usedAI, procedural, validation: basicValidation(finalSql) };
}
