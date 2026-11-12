import type { ColumnMeta, CompareResult, DiffItem, ObjectType } from "./types";

/**
 * Builds a SQL Server deployment script that makes the target match the source.
 * Ordered by dependency: types → tables → columns → keys → indexes → code (topologically sorted) → foreign keys.
 * EXTRA objects are listed as commented-out DROP statements: never dropped automatically.
 */

const q = (name: string) =>
  name
    .split(".")
    .map((p) => `[${p.replace(/\]/g, "]]")}]`)
    .join(".");

function colDdl(c: ColumnMeta): string {
  if (c.computed) return `${q(c.name)} AS ${c.computed}`;
  let s = `${q(c.name)} ${c.dataType.toUpperCase()}`;
  if (c.identity) s += ` IDENTITY(${c.identity.seed},${c.identity.increment})`;
  s += c.nullable ? " NULL" : " NOT NULL";
  if (c.defaultValue) s += ` DEFAULT ${c.defaultValue}`;
  return s;
}

function toCreateOrAlter(sql: string): string {
  return sql.replace(
    /\bCREATE\s+(?:OR\s+ALTER\s+)?(PROC|PROCEDURE|VIEW|FUNCTION|TRIGGER)\b/i,
    (_m, k: string) => `CREATE OR ALTER ${k.toUpperCase() === "PROC" ? "PROCEDURE" : k.toUpperCase()}`
  );
}

/** Order code objects so that anything referenced by another object is created first. */
function sortByDependency(items: DiffItem[]): DiffItem[] {
  const names = items.map((i) => ({ it: i, re: new RegExp(`(^|[^\\w])\\[?${i.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]?([^\\w]|$)`, "i") }));
  const deps = new Map<DiffItem, DiffItem[]>();
  for (const a of items) {
    const body = a.sourceDef || "";
    deps.set(
      a,
      names.filter((n) => n.it !== a && n.re.test(body)).map((n) => n.it)
    );
  }
  const out: DiffItem[] = [];
  const state = new Map<DiffItem, number>(); // 1 = visiting, 2 = done
  const visit = (x: DiffItem) => {
    if (state.get(x) === 2 || state.get(x) === 1) return;
    state.set(x, 1);
    for (const d of deps.get(x) || []) visit(d);
    state.set(x, 2);
    out.push(x);
  };
  items.forEach(visit);
  return out;
}

const CODE: ObjectType[] = ["Function", "View", "StoredProcedure", "Trigger"];

export function buildDeployScript(result: CompareResult, opts: { includeNoise?: boolean } = {}): string {
  const items = result.items.filter((i) => opts.includeNoise || !i.noise);
  const of = (type: ObjectType, status?: DiffItem["status"]) =>
    items.filter((i) => i.type === type && (!status || i.status === status));
  const out: string[] = [];
  const line = (s = "") => out.push(s);
  const section = (title: string) => {
    line();
    line(`-- ${"=".repeat(70)}`);
    line(`-- ${title}`);
    line(`-- ${"=".repeat(70)}`);
  };

  line(`-- SchemaSync AI deployment script`);
  line(`-- Source (reference): ${result.source.label}   Target: ${result.target.label}`);
  line(`-- Generated: ${new Date().toISOString()}`);
  line(`-- REVIEW BEFORE RUNNING. Run against: ${result.target.label}.`);
  line(`-- Objects flagged as noise (backup / temp / test) are ${opts.includeNoise ? "INCLUDED" : "NOT included"}.`);
  if (result.source.engine !== "sqlserver" || result.target.engine !== "sqlserver") {
    line(`-- NOTE: this script is generated in SQL Server syntax. For Oracle, convert it with the SQL Converter first.`);
  }

  // 1. table types
  const tt = of("TableType", "MISSING");
  if (tt.length) {
    section("Table types");
    for (const i of tt) {
      const cols = ((i.meta?.columns as ColumnMeta[]) || []).map((c) => `    ${q(c.name)} ${c.dataType.toUpperCase()}${c.nullable ? " NULL" : " NOT NULL"}`);
      line(`CREATE TYPE ${q(i.fullName)} AS TABLE (\n${cols.join(",\n")}\n);`);
      line("GO");
    }
  }
  for (const i of of("TableType", "DIFF")) line(`-- Table type ${i.fullName} differs: drop and recreate it together with the procedures that use it.`);

  // 2. sequences
  const seq = of("Sequence", "MISSING");
  if (seq.length) {
    section("Sequences");
    for (const i of seq) line(`CREATE SEQUENCE ${q(i.fullName)} ${i.sourceDef};`);
  }

  // 3. tables
  const tables = of("Table", "MISSING");
  if (tables.length) {
    section("New tables");
    for (const i of tables) {
      const cols = ((i.meta?.columns as ColumnMeta[]) || []).map((c) => `    ${colDdl(c)}`);
      const pk = i.meta?.pk as { name: string; clustered: boolean; columns: string[] } | null;
      if (pk) cols.push(`    CONSTRAINT ${q(pk.name)} PRIMARY KEY ${pk.clustered ? "CLUSTERED" : "NONCLUSTERED"} (${pk.columns.map((c) => c.replace(/^(\S+)/, (m) => q(m))).join(", ")})`);
      line(`CREATE TABLE ${q(i.fullName)} (\n${cols.join(",\n")}\n);`);
      line("GO");
    }
  }

  // 4. columns
  const addCols = of("Column", "MISSING");
  const altCols = of("Column", "DIFF");
  if (addCols.length || altCols.length) {
    section("Columns");
    for (const i of addCols) {
      const c = i.meta as unknown as ColumnMeta;
      if (!c.nullable && !c.defaultValue && !c.identity && !c.computed)
        line(`-- WARNING: NOT NULL without default. Fails if ${i.schema}.${i.parent} has rows. Add a DEFAULT or backfill first.`);
      line(`ALTER TABLE ${q(`${i.schema}.${i.parent}`)} ADD ${colDdl(c)};`);
    }
    for (const i of altCols) {
      const c = i.meta as unknown as ColumnMeta;
      line(`-- ${i.fullName}: target "${i.targetDef}" → source "${i.sourceDef}"`);
      if (c.computed || c.identity) {
        line(`-- Computed / identity columns cannot be altered in place: rebuild manually.`);
        continue;
      }
      line(`ALTER TABLE ${q(`${i.schema}.${i.parent}`)} ALTER COLUMN ${q(c.name)} ${c.dataType.toUpperCase()} ${c.nullable ? "NULL" : "NOT NULL"};`);
      if (c.defaultValue) line(`-- Default differs or is new: (re)create the default constraint: DEFAULT ${c.defaultValue}`);
    }
  }

  // 5. keys & checks
  const keys = [...of("PrimaryKey", "MISSING"), ...of("UniqueConstraint", "MISSING"), ...of("CheckConstraint", "MISSING")];
  if (keys.length) {
    section("Primary keys, unique and check constraints");
    for (const i of keys) {
      const m = i.meta || {};
      const table = q(String(m.table || `${i.schema}.${i.parent}`));
      const name = q(String(m.constraintName || i.name));
      if (i.type === "CheckConstraint") line(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK ${m.definition};`);
      else {
        const cols = ((m.columns as string[]) || []).map((c) => c.replace(/^(\S+)/, (x) => q(x))).join(", ");
        const kind = i.type === "PrimaryKey" ? "PRIMARY KEY" : "UNIQUE";
        line(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${kind} ${m.clustered ? "CLUSTERED" : "NONCLUSTERED"} (${cols});`);
      }
    }
  }
  for (const i of [...of("PrimaryKey", "DIFF"), ...of("UniqueConstraint", "DIFF"), ...of("CheckConstraint", "DIFF")])
    line(`-- ${i.fullName} differs: target "${i.targetDef}" vs source "${i.sourceDef}". Drop and recreate manually.`);

  // 6. indexes
  const idx = [...of("Index", "MISSING"), ...of("Index", "DIFF")];
  if (idx.length) {
    section("Indexes");
    for (const i of idx) {
      const m = i.meta || {};
      const table = q(String(m.table || `${i.schema}.${i.parent}`));
      if (i.status === "DIFF") line(`DROP INDEX IF EXISTS ${q(i.name)} ON ${table};`);
      const kind = String(m.kind || "NONCLUSTERED").toUpperCase().includes("CLUSTERED") ? String(m.kind).toUpperCase() : "NONCLUSTERED";
      const cols = ((m.columns as string[]) || []).map((c) => c.replace(/^(\S+)/, (x) => q(x))).join(", ");
      const inc = (m.include as string[]) || [];
      let s = `CREATE ${m.unique ? "UNIQUE " : ""}${kind} INDEX ${q(i.name)} ON ${table} (${cols})`;
      if (inc.length) s += ` INCLUDE (${inc.map(q).join(", ")})`;
      if (m.filter) s += ` WHERE ${m.filter}`;
      line(`${s};`);
    }
  }

  // 7. code objects in dependency order
  const code = sortByDependency(items.filter((i) => CODE.includes(i.type) && (i.status === "MISSING" || i.status === "DIFF")));
  if (code.length) {
    section("Functions, views, procedures and triggers (dependency order, CREATE OR ALTER needs SQL Server 2016 SP1+)");
    for (const i of code) {
      line(`-- ${i.status === "MISSING" ? "New" : "Changed"} ${i.type}: ${i.fullName}${i.risk === "High" ? `  (HIGH RISK: ${i.note})` : ""}`);
      line(toCreateOrAlter(i.sourceDef || "").trim());
      line("GO");
    }
  }

  // 8. foreign keys last
  const fks = of("ForeignKey", "MISSING");
  if (fks.length) {
    section("Foreign keys");
    for (const i of fks) {
      const m = i.meta || {};
      const cols = ((m.columns as string[]) || []).map(q).join(", ");
      const rcols = ((m.refColumns as string[]) || []).map(q).join(", ");
      let s = `ALTER TABLE ${q(String(m.table))} WITH CHECK ADD CONSTRAINT ${q(String(m.constraintName || i.name))} FOREIGN KEY (${cols}) REFERENCES ${q(String(m.refTable))} (${rcols})`;
      if (m.onDelete && m.onDelete !== "NO ACTION") s += ` ON DELETE ${m.onDelete}`;
      if (m.onUpdate && m.onUpdate !== "NO ACTION") s += ` ON UPDATE ${m.onUpdate}`;
      line(`${s};`);
    }
  }
  for (const i of of("ForeignKey", "DIFF")) line(`-- ${i.fullName} differs: target "${i.targetDef}" vs source "${i.sourceDef}".`);

  // 9. synonyms
  const syn = of("Synonym", "MISSING");
  if (syn.length) {
    section("Synonyms");
    for (const i of syn) line(`CREATE SYNONYM ${q(i.fullName)} ${i.sourceDef};`);
  }

  // 10. extra objects (never dropped automatically)
  const extra = items.filter((i) => i.status === "EXTRA");
  if (extra.length) {
    section("Only in target – review manually (commented out on purpose)");
    for (const i of extra) {
      const drop =
        i.type === "Column"
          ? `ALTER TABLE ${q(`${i.schema}.${i.parent}`)} DROP COLUMN ${q(i.name)};`
          : i.type === "Index"
            ? `DROP INDEX ${q(i.name)} ON ${q(`${i.schema}.${i.parent}`)};`
            : ["PrimaryKey", "UniqueConstraint", "ForeignKey", "CheckConstraint"].includes(i.type)
              ? `ALTER TABLE ${q(`${i.schema}.${i.parent}`)} DROP CONSTRAINT ${q(String(i.meta?.constraintName || i.name))};`
              : `DROP ${{ Table: "TABLE", View: "VIEW", StoredProcedure: "PROCEDURE", Function: "FUNCTION", Trigger: "TRIGGER", TableType: "TYPE", Sequence: "SEQUENCE", Synonym: "SYNONYM" }[i.type as string] || i.type.toUpperCase()} ${q(i.fullName)};`;
      line(`-- ${drop}`);
    }
  }

  line();
  line("-- End of script");
  return out.join("\n");
}
