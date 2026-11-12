import { describe, expect, it } from "vitest";
import { compareSnapshots } from "@/lib/compare";
import { demoSnapshots } from "@/lib/demo";
import { buildDeployScript } from "@/lib/deployScript";
import type { CompareResult, DiffItem } from "@/lib/types";
import { item, opts } from "./helpers";

const { source, target } = demoSnapshots();
const result = compareSnapshots(source, target, opts());
const script = buildDeployScript(result);

const make = (items: DiffItem[], engines: ["sqlserver" | "oracle", "sqlserver" | "oracle"] = ["sqlserver", "sqlserver"]): CompareResult => ({
  ...result,
  source: { label: "DEV", engine: engines[0] },
  target: { label: "SIT", engine: engines[1] },
  items,
});

describe("buildDeployScript – demo data", () => {
  it("has a header naming source and target", () => {
    expect(script).toMatch(/Source \(reference\): DEV \(demo\)\s+Target: SIT \(demo\)/);
    expect(script).toMatch(/REVIEW BEFORE RUNNING/);
  });

  it("orders sections by dependency", () => {
    const pos = (s: string) => script.indexOf(s);
    expect(pos("CREATE TYPE")).toBeGreaterThan(0);
    expect(pos("CREATE TYPE")).toBeLessThan(pos("CREATE TABLE"));
    expect(pos("CREATE TABLE")).toBeLessThan(pos("ALTER TABLE [ropa].[Claims] ADD"));
    expect(pos("ADD [ScopeType]")).toBeLessThan(pos("CREATE NONCLUSTERED INDEX"));
    expect(pos("CREATE NONCLUSTERED INDEX")).toBeLessThan(pos("CREATE OR ALTER FUNCTION"));
    expect(pos("CREATE OR ALTER FUNCTION")).toBeLessThan(pos("FOREIGN KEY"));
  });

  it("creates a dependency before the object that uses it", () => {
    expect(script.indexOf("FUNCTION ropa.fn_GetBusinessGroupIDsBasedOnRole")).toBeLessThan(script.indexOf("FUNCTION ropa.fn_GetClaimsByUserInfo"));
  });

  it("builds CREATE TABLE with columns, identity, defaults and the primary key", () => {
    expect(script).toContain("CREATE TABLE [ropa].[ActivityAlignment] (");
    expect(script).toContain("[Id] INT IDENTITY(1,1) NOT NULL");
    expect(script).toContain("[IsAligned] BIT NOT NULL DEFAULT ((0))");
    expect(script).toContain("CONSTRAINT [PK_ActivityAlignment] PRIMARY KEY CLUSTERED ([Id])");
  });

  it("warns about NOT NULL columns without default and alters changed columns", () => {
    expect(script).toMatch(/WARNING: NOT NULL without default.*\n.*ADD \[ScopeType\] VARCHAR\(20\) NOT NULL;/);
    expect(script).toContain("ALTER TABLE [ropa].[Records] ALTER COLUMN [Code] VARCHAR(100) NOT NULL;");
  });

  it("turns CREATE into CREATE OR ALTER and ends code batches with GO", () => {
    expect(script).not.toMatch(/^CREATE PROCEDURE/m);
    expect(script).toMatch(/CREATE OR ALTER PROCEDURE ropa\.sp_Ropa_ActiveAits[\s\S]*?\nGO/);
  });

  it("marks high-risk code objects", () => {
    expect(script).toMatch(/Changed Function: ropa\.fn_GetClaimsByUserInfo\s+\(HIGH RISK/);
  });

  it("excludes noise objects by default and includes them on request", () => {
    expect(script).not.toContain("3rdMarch2026");
    expect(buildDeployScript(result, { includeNoise: true })).toContain("sp_Ropa_ActiveGlobalValues_3rdMarch2026");
  });

  it("lists extra objects only as commented-out drops", () => {
    expect(script).toContain("-- ALTER TABLE [ropa].[Records] DROP COLUMN [LegacyCode];");
    expect(script).not.toMatch(/^ALTER TABLE \[ropa\]\.\[Records\] DROP/m);
  });
});

describe("buildDeployScript – other object types", () => {
  it("handles keys, checks, index DIFF, sequences, synonyms and extra drops", () => {
    const s = buildDeployScript(
      make([
        item({ type: "PrimaryKey", status: "MISSING", name: "PK", parent: "T", fullName: "dbo.T.PK", meta: { table: "dbo.T", constraintName: "PK_T", clustered: true, columns: ["Id"] } }),
        item({ type: "UniqueConstraint", status: "MISSING", name: "UQ_T", parent: "T", fullName: "dbo.T.UQ_T", meta: { table: "dbo.T", constraintName: "UQ_T", clustered: false, columns: ["Code DESC"] } }),
        item({ type: "CheckConstraint", status: "MISSING", name: "CK_T", parent: "T", fullName: "dbo.T.CK_T", meta: { table: "dbo.T", constraintName: "CK_T", definition: "([a]>(0))" } }),
        item({ type: "Index", status: "DIFF", name: "IX_T", parent: "T", fullName: "dbo.T.IX_T", meta: { table: "dbo.T", unique: true, kind: "NONCLUSTERED", columns: ["a"], include: ["b"], filter: "([a] IS NOT NULL)" } }),
        item({ type: "Sequence", status: "MISSING", name: "Seq", fullName: "dbo.Seq", sourceDef: "AS bigint START WITH 1 INCREMENT BY 1" }),
        item({ type: "Synonym", status: "MISSING", name: "Syn", fullName: "dbo.Syn", sourceDef: "FOR other.dbo.T" }),
        item({ type: "ForeignKey", status: "MISSING", name: "FK_A", parent: "A", fullName: "dbo.A.FK_A", meta: { table: "dbo.A", constraintName: "FK_A", columns: ["TId"], refTable: "dbo.T", refColumns: ["Id"], onDelete: "CASCADE", onUpdate: "NO ACTION" } }),
        item({ type: "ForeignKey", status: "DIFF", name: "FK_B", parent: "B", fullName: "dbo.B.FK_B", sourceDef: "x", targetDef: "y" }),
        item({ type: "TableType", status: "DIFF", name: "TT", fullName: "dbo.TT" }),
        item({ type: "View", status: "EXTRA", name: "V", fullName: "dbo.V" }),
        item({ type: "Index", status: "EXTRA", name: "IX_X", parent: "T", fullName: "dbo.T.IX_X" }),
        item({ type: "ForeignKey", status: "EXTRA", name: "FK_C", parent: "T", fullName: "dbo.T.FK_C", meta: { constraintName: "FK_C" } }),
      ])
    );
    expect(s).toContain("ALTER TABLE [dbo].[T] ADD CONSTRAINT [PK_T] PRIMARY KEY CLUSTERED ([Id]);");
    expect(s).toContain("ADD CONSTRAINT [UQ_T] UNIQUE NONCLUSTERED ([Code] DESC);");
    expect(s).toContain("ADD CONSTRAINT [CK_T] CHECK ([a]>(0));");
    expect(s).toContain("DROP INDEX IF EXISTS [IX_T] ON [dbo].[T];");
    expect(s).toContain("CREATE UNIQUE NONCLUSTERED INDEX [IX_T] ON [dbo].[T] ([a]) INCLUDE ([b]) WHERE ([a] IS NOT NULL);");
    expect(s).toContain("CREATE SEQUENCE [dbo].[Seq] AS bigint START WITH 1 INCREMENT BY 1;");
    expect(s).toContain("CREATE SYNONYM [dbo].[Syn] FOR other.dbo.T;");
    expect(s).toContain("FOREIGN KEY ([TId]) REFERENCES [dbo].[T] ([Id]) ON DELETE CASCADE;");
    expect(s).toMatch(/-- dbo\.B\.FK_B differs/);
    expect(s).toMatch(/Table type dbo\.TT differs/);
    expect(s).toContain("-- DROP VIEW [dbo].[V];");
    expect(s).toContain("-- DROP INDEX [IX_X] ON [dbo].[T];");
    expect(s).toContain("-- ALTER TABLE [dbo].[T] DROP CONSTRAINT [FK_C];");
  });

  it("adds an Oracle note when an engine is not SQL Server", () => {
    expect(buildDeployScript(make([], ["oracle", "oracle"]))).toMatch(/convert it with the SQL Converter/);
  });

  it("does not loop on circular code references", () => {
    const a = item({ id: "a", type: "View", name: "VA", fullName: "dbo.VA", sourceDef: "CREATE VIEW VA AS SELECT * FROM VB" });
    const b = item({ id: "b", type: "View", name: "VB", fullName: "dbo.VB", sourceDef: "CREATE VIEW VB AS SELECT * FROM VA" });
    const s = buildDeployScript(make([a, b]));
    expect(s.match(/CREATE OR ALTER VIEW/g)).toHaveLength(2);
  });

  it("skips altering identity / computed columns", () => {
    const s = buildDeployScript(
      make([item({ type: "Column", status: "DIFF", name: "c", parent: "T", fullName: "dbo.T.c", sourceDef: "a", targetDef: "b", meta: { name: "c", dataType: "int", nullable: false, computed: "a+b" } })])
    );
    expect(s).toMatch(/cannot be altered in place/);
    expect(s).not.toContain("ALTER COLUMN");
  });
});
