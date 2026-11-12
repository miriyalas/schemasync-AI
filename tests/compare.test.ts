import { describe, expect, it } from "vitest";
import { compareSnapshots, fullNameOf, summarize, wantedTypes } from "@/lib/compare";
import { demoSnapshots } from "@/lib/demo";
import type { DbObject } from "@/lib/types";
import { col, opts, proc, snap, tbl } from "./helpers";

describe("wantedTypes", () => {
  it("maps checkbox groups to object types", () => {
    const w = wantedTypes(opts({ groups: ["tables", "procedures"] }));
    expect([...w].sort()).toEqual(["Column", "StoredProcedure", "Table"]);
  });
  it("returns nothing for no groups", () => {
    expect(wantedTypes(opts({ groups: [] })).size).toBe(0);
  });
});

describe("compareSnapshots – statuses", () => {
  it("identical schemas produce no differences", () => {
    const objs = [tbl("T"), col("T", "a", "int NOT NULL"), proc("p", "SELECT 1")];
    const r = compareSnapshots(snap(objs), snap(objs, "SIT"), opts());
    expect(r.items).toEqual([]);
    expect(r.summary.total).toBe(0);
  });

  it("reports MISSING, EXTRA and DIFF", () => {
    const r = compareSnapshots(
      snap([proc("onlyDev", "SELECT 1"), proc("both", "SELECT 1")]),
      snap([proc("onlySit", "SELECT 1"), proc("both", "SELECT 2")], "SIT"),
      opts()
    );
    const by = Object.fromEntries(r.items.map((i) => [i.name, i.status]));
    expect(by).toEqual({ onlyDev: "MISSING", onlySit: "EXTRA", both: "DIFF" });
    expect(r.summary).toMatchObject({ total: 3, missing: 1, extra: 1, diff: 1 });
  });

  it("MISSING keeps the source definition, EXTRA keeps the target definition", () => {
    const r = compareSnapshots(snap([proc("a", "SELECT 1")]), snap([proc("b", "SELECT 2")], "SIT"), opts());
    const a = r.items.find((i) => i.name === "a")!;
    const b = r.items.find((i) => i.name === "b")!;
    expect(a.sourceDef).toContain("SELECT 1");
    expect(a.targetDef).toBeUndefined();
    expect(b.targetDef).toContain("SELECT 2");
    expect(a.added).toBeGreaterThan(0);
    expect(b.removed).toBeGreaterThan(0);
  });

  it("formatting-only differences are ignored when normalisation is on", () => {
    const dev = [proc("p", "SELECT a FROM t -- note")];
    const sit = [{ ...proc("p", "select   a\n  from T"), def: "create   proc [dbo].[p] as begin select a from T end" }];
    expect(compareSnapshots(snap(dev), snap(sit, "SIT"), opts()).items).toHaveLength(0);
    expect(compareSnapshots(snap(dev), snap(sit, "SIT"), opts({ ignoreWhitespace: false, ignoreCase: false })).items).toHaveLength(1);
  });

  it("counts added / removed lines for DIFF", () => {
    const r = compareSnapshots(snap([proc("p", "SELECT 1\nSELECT 2\nSELECT 3")]), snap([proc("p", "SELECT 1")], "SIT"), opts());
    expect(r.items[0]).toMatchObject({ status: "DIFF", added: 2, removed: 0 });
  });

  it("compares non-code definitions (column types) and respects ignoreCase", () => {
    const r1 = compareSnapshots(snap([tbl("T"), col("T", "a", "int NOT NULL")]), snap([tbl("T"), col("T", "a", "INT  NOT NULL")], "SIT"), opts());
    expect(r1.items).toHaveLength(0);
    const r2 = compareSnapshots(snap([tbl("T"), col("T", "a", "int NOT NULL")]), snap([tbl("T"), col("T", "a", "INT NOT NULL")], "SIT"), opts({ ignoreCase: false }));
    expect(r2.items).toHaveLength(1);
  });

  it("matches names case-insensitively", () => {
    const r = compareSnapshots(snap([proc("GetX", "SELECT 1")]), snap([proc("getx", "SELECT 1", "DBO")], "SIT"), opts());
    expect(r.items).toHaveLength(0);
  });

  it("only compares the selected object types", () => {
    const r = compareSnapshots(snap([proc("p", "SELECT 1"), tbl("T")]), snap([], "SIT"), opts({ groups: ["tables"] }));
    expect(r.items.map((i) => i.type)).toEqual(["Table"]);
  });
});

describe("compareSnapshots – parent / child folding", () => {
  it("columns of a missing table are folded into the table item", () => {
    const dev = [tbl("New"), col("New", "a", "int NULL"), col("New", "b", "int NULL")];
    const r = compareSnapshots(snap(dev), snap([], "SIT"), opts());
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ type: "Table", status: "MISSING" });
    expect(r.items[0].note).toContain("2 columns");
  });

  it("columns of an extra table are folded too", () => {
    const r = compareSnapshots(snap([], "DEV"), snap([tbl("Old"), col("Old", "a", "int NULL")], "SIT"), opts());
    expect(r.items).toHaveLength(1);
    expect(r.items[0].status).toBe("EXTRA");
  });

  it("a missing column on an existing table is its own item", () => {
    const r = compareSnapshots(snap([tbl("T"), col("T", "a", "int NULL"), col("T", "b", "int NULL")]), snap([tbl("T"), col("T", "a", "int NULL")], "SIT"), opts());
    expect(r.items.map((i) => i.fullName)).toEqual(["dbo.T.b"]);
  });

  it("table type columns fold into a missing table type", () => {
    const dev: DbObject[] = [
      { type: "TableType", schema: "dbo", name: "TT", def: "a int", meta: { columns: [] } },
      { type: "TableTypeColumn", schema: "dbo", parent: "TT", name: "a", def: "int NULL" },
    ];
    const r = compareSnapshots(snap(dev), snap([], "SIT"), opts());
    expect(r.items.map((i) => i.type)).toEqual(["TableType"]);
  });
});

describe("compareSnapshots – Oracle and cross-engine", () => {
  it("ignores the Oracle owner so APP_DEV matches APP_SIT", () => {
    const o = (owner: string): DbObject => ({ type: "View", schema: owner, name: "V1", def: "CREATE OR REPLACE VIEW V1 AS SELECT 1 FROM DUAL", code: true });
    const r = compareSnapshots(snap([o("APP_DEV")], "DEV", "oracle"), snap([o("APP_SIT")], "SIT", "oracle"), opts());
    expect(r.items).toHaveLength(0);
  });

  it("warns when engines differ", () => {
    const r = compareSnapshots(snap([], "DEV", "sqlserver"), snap([], "SIT", "oracle"), opts());
    expect(r.warnings.join(" ")).toMatch(/different engines/);
  });

  it("prefixes snapshot warnings with the environment label", () => {
    const s = snap([], "DEV");
    s.warnings.push("Query failed");
    expect(compareSnapshots(s, snap([], "SIT"), opts()).warnings).toContain("DEV: Query failed");
  });
});

describe("compareSnapshots – sorting and summary", () => {
  it("sorts by dependency type order, then DIFF/MISSING/EXTRA, then name", () => {
    const r = compareSnapshots(
      snap([proc("b", "SELECT 1"), tbl("T"), proc("a", "SELECT 1"), proc("d", "SELECT 9")]),
      snap([proc("c", "SELECT 1"), proc("d", "SELECT 1")], "SIT"),
      opts()
    );
    expect(r.items.map((i) => `${i.type}:${i.status}:${i.name}`)).toEqual([
      "Table:MISSING:T",
      "StoredProcedure:DIFF:d",
      "StoredProcedure:MISSING:a",
      "StoredProcedure:MISSING:b",
      "StoredProcedure:EXTRA:c",
    ]);
  });

  it("summarize counts by type and risk", () => {
    const r = compareSnapshots(snap([proc("x_bak", "SELECT 1"), proc("real", "SELECT 1")]), snap([], "SIT"), opts());
    expect(r.summary.byType.StoredProcedure).toEqual({ missing: 2, extra: 0, diff: 0 });
    expect(r.summary.byRisk).toMatchObject({ Noise: 1, Low: 1 });
    expect(r.summary.noise).toBe(1);
    expect(summarize([]).total).toBe(0);
  });

  it("builds stable ids and full names", () => {
    expect(fullNameOf({ schema: "s", parent: "t", name: "c" })).toBe("s.t.c");
    expect(fullNameOf({ schema: "s", name: "p" })).toBe("s.p");
    const r = compareSnapshots(snap([proc("p", "SELECT 1")]), snap([], "SIT"), opts());
    expect(r.items[0].id).toBe("MISSING|StoredProcedure|dbo.p");
  });
});

describe("demo data end to end", () => {
  const { source, target } = demoSnapshots();
  const r = compareSnapshots(source, target, opts());

  it("finds the expected differences", () => {
    expect(r.summary).toMatchObject({ missing: 18, extra: 2, diff: 6 });
  });

  it("flags the backup / copilot / temp objects as noise", () => {
    const noise = r.items.filter((i) => i.noise).map((i) => i.name);
    expect(noise).toEqual(expect.arrayContaining(["sp_Ropa_ActiveGlobalValues_3rdMarch2026", "sp_Ropa_ActivePDC_Concatenated_Copilot", "sp_Ropa_Records_old", "geo_alias"]));
  });

  it("detects the signature change on fn_GetClaimsByUserInfo as High", () => {
    expect(r.items.find((i) => i.name === "fn_GetClaimsByUserInfo")).toMatchObject({ status: "DIFF", risk: "High" });
  });
});
