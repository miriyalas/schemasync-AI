import { aiConfig } from "./ai";
import { compareSnapshots } from "./compare";
import { convertSql } from "./converter";
import { demoSnapshots } from "./demo";
import { buildDeployScript } from "./deployScript";
import type { CompareOptions, DbObject, Snapshot } from "./types";

/**
 * Live self-check: runs the real engine (compare, risk, converter, deploy script) on
 * known inputs inside the deployed server and reports each result. Lets anyone verify
 * the running app, not just the build, without needing a database.
 */

export interface SelfCheck {
  id: string;
  area: "Compare" | "Risk & noise" | "Converter" | "Deploy script" | "Environment";
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
  ms: number;
  info?: boolean;
}

const OPTS: CompareOptions = {
  groups: ["tables", "keys", "foreignKeys", "checks", "indexes", "views", "procedures", "functions", "triggers", "tableTypes", "sequences"],
  ignoreWhitespace: true,
  ignoreCase: true,
};
const snap = (objects: DbObject[], label: string, engine: Snapshot["engine"] = "sqlserver"): Snapshot => ({
  engine,
  label,
  objects,
  warnings: [],
  extractedAt: new Date().toISOString(),
});
const proc = (name: string, def: string, schema = "dbo"): DbObject => ({ type: "StoredProcedure", schema, name, def, code: true });

export async function runSelfTest(): Promise<{ checks: SelfCheck[]; passed: number; failed: number; ranAt: string }> {
  const checks: SelfCheck[] = [];
  const add = async (
    id: string,
    area: SelfCheck["area"],
    name: string,
    expected: string,
    fn: () => string | Promise<string>,
    info = false
  ) => {
    const t0 = performance.now();
    let actual: string;
    try {
      actual = await fn();
    } catch (e) {
      actual = `Error: ${(e as Error).message}`;
    }
    checks.push({ id, area, name, expected, actual, pass: info || actual === expected, ms: Math.round((performance.now() - t0) * 10) / 10, info });
  };

  const { source, target } = demoSnapshots();
  const demo = compareSnapshots(source, target, OPTS);

  await add("C1", "Compare", "Demo databases: missing / extra / diff counts", "18 / 2 / 6", () => `${demo.summary.missing} / ${demo.summary.extra} / ${demo.summary.diff}`);
  await add("C2", "Compare", "Identical objects produce no differences", "0", () =>
    String(compareSnapshots(snap([proc("p", "CREATE PROCEDURE p AS SELECT 1")], "A"), snap([proc("p", "CREATE PROCEDURE p AS SELECT 1")], "B"), OPTS).items.length)
  );
  await add("C3", "Compare", "Whitespace, comments, case and [brackets] are ignored", "0", () =>
    String(
      compareSnapshots(
        snap([proc("p", "CREATE PROCEDURE dbo.p AS\n-- note\nSELECT a FROM t")], "A"),
        snap([proc("p", "create   proc [dbo].[p] as select A from T\nGO")], "B"),
        OPTS
      ).items.length
    )
  );
  await add("C4", "Compare", "A real logic change is reported as DIFF", "DIFF", () =>
    compareSnapshots(snap([proc("p", "CREATE PROCEDURE p AS SELECT 1")], "A"), snap([proc("p", "CREATE PROCEDURE p AS SELECT 2")], "B"), OPTS).items[0]?.status ?? "none"
  );
  await add("C5", "Compare", "Columns of a missing table are folded into one row", "1 row (Table)", () => {
    const r = compareSnapshots(
      snap(
        [
          { type: "Table", schema: "dbo", name: "T", def: "" },
          { type: "Column", schema: "dbo", parent: "T", name: "a", def: "int NULL" },
          { type: "Column", schema: "dbo", parent: "T", name: "b", def: "int NULL" },
        ],
        "A"
      ),
      snap([], "B"),
      OPTS
    );
    return `${r.items.length} row (${r.items.map((i) => i.type).join(",")})`;
  });
  await add("C6", "Compare", "Oracle schemas APP_DEV and APP_SIT are matched", "0", () => {
    const v = (o: string): DbObject => ({ type: "View", schema: o, name: "V", def: "CREATE OR REPLACE VIEW V AS SELECT 1 FROM DUAL", code: true });
    return String(compareSnapshots(snap([v("APP_DEV")], "A", "oracle"), snap([v("APP_SIT")], "B", "oracle"), OPTS).items.length);
  });

  await add("R1", "Risk & noise", "Backup copy …_3rdMarch2026 is flagged as noise", "Noise", () => demo.items.find((i) => i.name.endsWith("_3rdMarch2026"))?.risk ?? "missing");
  await add("R2", "Risk & noise", "…_Copilot experiment is flagged as noise", "Noise", () => demo.items.find((i) => i.name.endsWith("_Copilot"))?.risk ?? "missing");
  await add("R3", "Risk & noise", "Function parameter change is High risk", "High", () => demo.items.find((i) => i.name === "fn_GetClaimsByUserInfo")?.risk ?? "missing");
  await add("R4", "Risk & noise", "New NOT NULL column without default is High risk", "High", () => demo.items.find((i) => i.name === "ScopeType")?.risk ?? "missing");
  await add("R5", "Risk & noise", "Column only in target is High risk (data loss)", "High", () => demo.items.find((i) => i.name === "LegacyCode")?.risk ?? "missing");

  const t2o = async (sql: string) => (await convertSql(sql, "sqlserver", "oracle", false)).sql.replace(/\s+/g, " ").trim();
  const o2t = async (sql: string) => (await convertSql(sql, "oracle", "sqlserver", false)).sql.replace(/\s+/g, " ").trim();
  await add("V1", "Converter", "T-SQL TOP / ISNULL / GETDATE → Oracle", "SELECT NVL(a, 0), SYSDATE FROM t ORDER BY a FETCH FIRST 5 ROWS ONLY", () =>
    t2o("SELECT TOP 5 ISNULL(a, 0), GETDATE() FROM t ORDER BY a")
  );
  await add("V2", "Converter", "T-SQL string + → Oracle ||", "SELECT a || ' - ' || b FROM t", () => t2o("SELECT a + ' - ' + b FROM t"));
  await add("V3", "Converter", "Text inside strings and comments is never changed", "SELECT 'GETDATE()' FROM DUAL -- ISNULL(x)", () => t2o("SELECT 'GETDATE()' -- ISNULL(x)"));
  await add("V4", "Converter", "T-SQL data types → Oracle", "CREATE TABLE x (a NUMBER(10), b NVARCHAR2(50), c CLOB, d TIMESTAMP, e NUMBER(1))", () =>
    t2o("CREATE TABLE x (a INT, b NVARCHAR(50), c VARCHAR(MAX), d DATETIME2(7), e BIT)")
  );
  await add("V5", "Converter", "Oracle DECODE / NVL / FETCH → T-SQL", "SELECT TOP (3) CASE a WHEN 1 THEN 'x' ELSE 'y' END, ISNULL(b, 0) FROM t", () =>
    o2t("SELECT DECODE(a, 1, 'x', 'y'), NVL(b, 0) FROM t FETCH FIRST 3 ROWS ONLY")
  );
  await add("V6", "Converter", "Procedures are detected as procedural code", "true", async () =>
    String((await convertSql("CREATE PROCEDURE p AS BEGIN TRY SELECT 1 END TRY BEGIN CATCH THROW; END CATCH", "sqlserver", "oracle", false)).procedural)
  );

  const script = buildDeployScript(demo);
  const pos = (s: string) => script.indexOf(s);
  await add("D1", "Deploy script", "Order: table types → tables → code → foreign keys", "true", () =>
    String(pos("CREATE TYPE") > 0 && pos("CREATE TYPE") < pos("CREATE TABLE") && pos("CREATE TABLE") < pos("CREATE OR ALTER") && pos("CREATE OR ALTER") < pos("FOREIGN KEY"))
  );
  await add("D2", "Deploy script", "A function is created before the function that calls it", "true", () =>
    String(pos("FUNCTION ropa.fn_GetBusinessGroupIDsBasedOnRole") < pos("FUNCTION ropa.fn_GetClaimsByUserInfo"))
  );
  await add("D3", "Deploy script", "Noise objects are left out", "false", () => String(script.includes("3rdMarch2026")));
  await add("D4", "Deploy script", "Objects only in target are never dropped (comment only)", "true", () =>
    String(script.includes("-- ALTER TABLE [ropa].[Records] DROP COLUMN [LegacyCode];") && !/^ALTER TABLE \[ropa\]\.\[Records\] DROP/m.test(script))
  );

  const ai = aiConfig();
  await add("E1", "Environment", "AI provider", "", () => (ai.enabled ? `${ai.provider} · ${ai.model}` : "not configured (rule-based checks only)"), true);
  await add("E2", "Environment", "Server runtime", "", () => `Node.js ${process.version}`, true);

  const real = checks.filter((c) => !c.info);
  return { checks, passed: real.filter((c) => c.pass).length, failed: real.filter((c) => !c.pass).length, ranAt: new Date().toISOString() };
}
