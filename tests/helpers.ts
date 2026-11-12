import type { CompareOptions, DbObject, DiffItem, Snapshot } from "@/lib/types";

export const ALL_GROUPS = ["tables", "keys", "foreignKeys", "checks", "indexes", "views", "procedures", "functions", "triggers", "tableTypes", "sequences", "packages"];

export const opts = (o: Partial<CompareOptions> = {}): CompareOptions => ({
  groups: ALL_GROUPS,
  ignoreWhitespace: true,
  ignoreCase: true,
  ...o,
});

export const snap = (objects: DbObject[], label = "DEV", engine: Snapshot["engine"] = "sqlserver"): Snapshot => ({
  engine,
  label,
  objects,
  warnings: [],
  extractedAt: "2026-01-01T00:00:00Z",
});

export const proc = (name: string, body: string, schema = "dbo"): DbObject => ({
  type: "StoredProcedure",
  schema,
  name,
  def: `CREATE PROCEDURE ${schema}.${name}\nAS\nBEGIN\n${body}\nEND`,
  code: true,
});

export const tbl = (name: string, schema = "dbo"): DbObject => ({ type: "Table", schema, name, def: "", meta: { columns: [], pk: null } });

export const col = (table: string, name: string, def: string, meta: Record<string, unknown> = {}, schema = "dbo"): DbObject => ({
  type: "Column",
  schema,
  parent: table,
  name,
  def,
  meta: { table: `${schema}.${table}`, name, dataType: def.split(" ")[0], nullable: !/NOT NULL/.test(def), ...meta },
});

export const item = (p: Partial<DiffItem>): DiffItem => ({
  id: "x",
  type: "StoredProcedure",
  schema: "dbo",
  name: "p",
  fullName: "dbo.p",
  status: "MISSING",
  added: 0,
  removed: 0,
  risk: "Low",
  noise: false,
  note: "",
  ...p,
});
