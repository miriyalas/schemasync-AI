import { describe, expect, it } from "vitest";
import { analyzeItem, noiseReason } from "@/lib/analyze";
import { item } from "./helpers";

describe("noiseReason – backup / temp / test detection", () => {
  it.each([
    ["sp_Ropa_ActiveGlobalValues_3rdMarch2026", /backup/i],
    ["sp_Ropa_ActivePOPs_3rdMarch2026", /backup/i],
    ["usp_Report_March_15_2024", /backup/i],
    ["Customers_20240115", /Date stamp/i],
    ["Orders_bak", /Backup/i],
    ["Orders_old", /Backup/i],
    ["Orders_copy2", /Backup/i],
    ["sp_Ropa_ActivePDC_Concatenated_Copilot", /Experimental/i],
    ["ISSUINGAUTHORITY_REGULATORS_TEMPSRCTABLE", /Temporary/i],
    ["tmp_Load", /Temporary/i],
    ["Invoice_test", /Test/i],
    ["test_Invoice", /Test/i],
  ])("flags %s", (name, reason) => {
    expect(noiseReason(name)).toMatch(reason);
  });

  it.each(["sp_Ropa_ActiveAits", "GetallActivitiesNames", "Template", "Temperature", "IsDeleted", "Old_Value", "Summary", "SaveActivityAlignExternalTransfer_V1", "ropa_Scoped_Pops", "TestResult", "OrderHistory"])(
    "does not flag %s",
    (name) => {
      expect(noiseReason(name)).toBeNull();
    }
  );
});

describe("analyzeItem – rule-based risk", () => {
  it("marks noise objects as Noise regardless of status", () => {
    expect(analyzeItem(item({ name: "x_bak" })).risk).toBe("Noise");
    expect(analyzeItem(item({ type: "Column", name: "geo_code", parent: "REG_TEMPSRCTABLE" })).noise).toBe(true);
  });

  it("MISSING table is low risk and mentions the column count", () => {
    const r = analyzeItem(item({ type: "Table", name: "Orders" }), 4);
    expect(r.risk).toBe("Low");
    expect(r.note).toContain("4 columns");
  });

  it("MISSING NOT NULL column without default is High", () => {
    expect(analyzeItem(item({ type: "Column", name: "c", meta: { nullable: false } })).risk).toBe("High");
  });

  it("MISSING nullable / defaulted / identity / computed columns are Low", () => {
    for (const meta of [{ nullable: true }, { nullable: false, defaultValue: "0" }, { nullable: false, identity: { seed: "1", increment: "1" } }, { nullable: false, computed: "a+b" }])
      expect(analyzeItem(item({ type: "Column", name: "c", meta })).risk).toBe("Low");
  });

  it.each([
    ["TableType", "Medium"],
    ["PrimaryKey", "Medium"],
    ["UniqueConstraint", "Medium"],
    ["ForeignKey", "Medium"],
    ["CheckConstraint", "Medium"],
    ["Index", "Low"],
    ["StoredProcedure", "Low"],
    ["View", "Low"],
  ] as const)("MISSING %s → %s", (type, risk) => {
    expect(analyzeItem(item({ type, name: "obj" })).risk).toBe(risk);
  });

  it("EXTRA tables and columns are High (data loss if dropped)", () => {
    expect(analyzeItem(item({ status: "EXTRA", type: "Table", name: "T" })).risk).toBe("High");
    expect(analyzeItem(item({ status: "EXTRA", type: "Column", name: "C" })).risk).toBe("High");
    expect(analyzeItem(item({ status: "EXTRA", type: "View", name: "V" })).risk).toBe("Medium");
  });

  it("DIFF column: type change and NOT NULL are High, other changes Medium", () => {
    const d = (s: string, t: string) => analyzeItem(item({ status: "DIFF", type: "Column", name: "c", sourceDef: s, targetDef: t }));
    expect(d("varchar(100) NOT NULL", "varchar(50) NOT NULL")).toMatchObject({ risk: "High", note: expect.stringContaining("varchar(50) → varchar(100)") });
    expect(d("int NOT NULL", "int NULL").risk).toBe("High");
    expect(d("int NULL DEFAULT 1", "int NULL").risk).toBe("Medium");
  });

  it("DIFF procedure: signature change is High, body change Medium", () => {
    const base = "CREATE PROCEDURE p @a INT AS SELECT 1";
    expect(analyzeItem(item({ status: "DIFF", sourceDef: "CREATE PROCEDURE p @a INT, @b INT AS SELECT 1", targetDef: base })).risk).toBe("High");
    expect(analyzeItem(item({ status: "DIFF", sourceDef: "CREATE PROCEDURE p @a INT AS SELECT 2", targetDef: base, added: 1, removed: 1 })).risk).toBe("Medium");
    expect(analyzeItem(item({ status: "DIFF", sourceDef: "create or alter proc p @a int as SELECT 2", targetDef: base })).risk).toBe("Medium");
  });

  it("DIFF function signature (RETURNS) change is High", () => {
    const r = analyzeItem(
      item({ status: "DIFF", type: "Function", sourceDef: "CREATE FUNCTION f(@a INT) RETURNS BIGINT AS BEGIN RETURN 1 END", targetDef: "CREATE FUNCTION f(@a INT) RETURNS INT AS BEGIN RETURN 1 END" })
    );
    expect(r.risk).toBe("High");
  });

  it.each([
    ["View", "Medium"],
    ["Trigger", "Medium"],
    ["TableType", "High"],
    ["TableTypeColumn", "High"],
    ["ForeignKey", "Medium"],
    ["Index", "Low"],
    ["Sequence", "Low"],
  ] as const)("DIFF %s → %s", (type, risk) => {
    expect(analyzeItem(item({ status: "DIFF", type, name: "obj", sourceDef: "a", targetDef: "b" })).risk).toBe(risk);
  });
});
