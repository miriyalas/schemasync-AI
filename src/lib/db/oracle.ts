import oracledb from "oracledb";
import type { ColumnMeta, ConnectionInput, DbObject, ObjectType, Snapshot } from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

// Thin mode (pure JavaScript) – no Oracle Instant Client needed, works on Vercel.
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchArraySize = 1000;

async function connect(c: ConnectionInput) {
  return oracledb.getConnection({
    user: c.user,
    password: c.password,
    connectString: `${c.host}:${c.port || 1521}/${c.serviceName || c.database || ""}`,
  });
}

export async function testOracle(c: ConnectionInput) {
  const conn = await connect(c);
  try {
    const v = await conn.execute<Row>(`SELECT banner AS VERSION FROM v$version WHERE ROWNUM = 1`).catch(() => null);
    const owner = (c.schema || c.user).toUpperCase();
    const cnt = await conn.execute<Row>(`SELECT COUNT(*) AS N FROM all_objects WHERE owner = :o`, { o: owner });
    return {
      ok: true,
      version: v?.rows?.[0]?.VERSION || `Oracle ${conn.oracleServerVersionString}`,
      database: owner,
      canViewDefinition: Number(cnt.rows?.[0]?.N || 0) > 0,
    };
  } finally {
    await conn.close();
  }
}

export function oracleType(r: Row): string {
  const t = String(r.DATA_TYPE).toUpperCase();
  if (["VARCHAR2", "NVARCHAR2", "CHAR", "NCHAR"].includes(t)) {
    const len = r.CHAR_LENGTH || r.DATA_LENGTH;
    const charSemantics = r.CHAR_USED === "C" && !t.startsWith("N") ? " CHAR" : "";
    return `${t}(${len}${charSemantics})`;
  }
  if (t === "NUMBER") {
    if (r.DATA_PRECISION == null) return r.DATA_SCALE === 0 ? "NUMBER(*,0)" : "NUMBER";
    return r.DATA_SCALE ? `NUMBER(${r.DATA_PRECISION},${r.DATA_SCALE})` : `NUMBER(${r.DATA_PRECISION})`;
  }
  if (t === "RAW") return `RAW(${r.DATA_LENGTH})`;
  if (t === "FLOAT") return `FLOAT(${r.DATA_PRECISION})`;
  return t;
}

const SOURCE_TYPES: Record<string, ObjectType> = {
  PROCEDURE: "StoredProcedure",
  FUNCTION: "Function",
  PACKAGE: "Package",
  "PACKAGE BODY": "PackageBody",
  TRIGGER: "Trigger",
};

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}

const SYS_NAME = /^SYS_C\d+$/i;

export async function snapshotOracle(c: ConnectionInput, wanted: Set<ObjectType>): Promise<Snapshot> {
  const conn = await connect(c);
  const owner = (c.schema || c.user).toUpperCase();
  const warnings: string[] = [];
  const objects: DbObject[] = [];
  const want = (...t: ObjectType[]) => t.some((x) => wanted.has(x));

  // Prefer DBA_ views (see every object), fall back to ALL_ views.
  let p = "ALL";
  try {
    await conn.execute(`SELECT 1 FROM dba_objects WHERE ROWNUM = 1`);
    p = "DBA";
  } catch {
    warnings.push("Using ALL_* views: only objects visible to the login user are compared. Grant SELECT ANY DICTIONARY for full coverage.");
  }

  const run = async (q: string, enabled: boolean): Promise<Row[]> => {
    if (!enabled) return [];
    try {
      const r = await conn.execute<Row>(q, { o: owner });
      return r.rows || [];
    } catch (e) {
      warnings.push(`Query failed (${(e as Error).message}).`);
      return [];
    }
  };

  try {
    const needTables = want("Table", "Column", "PrimaryKey");
    const needCons = want("PrimaryKey", "UniqueConstraint", "ForeignKey", "CheckConstraint", "Index", "Table");

    // Run sequentially: one Oracle connection does not run queries in parallel.
    const tables = await run(
      `SELECT table_name FROM ${p}_tables WHERE owner = :o AND nested = 'NO' AND secondary = 'N' AND table_name NOT LIKE 'BIN$%'`,
      needTables || needCons
    );
    const columns = await run(
      `SELECT table_name, column_name, column_id, data_type, data_length, data_precision, data_scale, nullable, data_default, char_used, char_length
       FROM ${p}_tab_columns WHERE owner = :o ORDER BY table_name, column_id`,
      needTables
    );
    const identity = await run(`SELECT table_name, column_name, generation_type FROM ${p}_tab_identity_cols WHERE owner = :o`, needTables);
    const cons = await run(
      `SELECT c.constraint_name, c.constraint_type, c.table_name, c.r_owner, c.r_constraint_name, c.delete_rule, c.status,
              c.search_condition, c.generated, c.index_name, cc.column_name, cc.position
       FROM ${p}_constraints c
       LEFT JOIN ${p}_cons_columns cc ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name AND cc.table_name = c.table_name
       WHERE c.owner = :o AND c.constraint_type IN ('P','U','R','C') AND c.table_name NOT LIKE 'BIN$%'
       ORDER BY c.table_name, c.constraint_name, cc.position`,
      needCons
    );
    const idx = await run(
      `SELECT i.index_name, i.table_name, i.uniqueness, i.index_type, ic.column_name, ic.column_position, ic.descend
       FROM ${p}_indexes i
       JOIN ${p}_ind_columns ic ON ic.index_owner = i.owner AND ic.index_name = i.index_name
       WHERE i.owner = :o AND i.table_owner = :o AND i.index_type <> 'LOB' AND i.table_name NOT LIKE 'BIN$%'
       ORDER BY i.table_name, i.index_name, ic.column_position`,
      want("Index")
    );
    const views = await run(`SELECT view_name, text FROM ${p}_views WHERE owner = :o`, want("View"));
    const source = await run(
      `SELECT name, type, line, text FROM ${p}_source
       WHERE owner = :o AND type IN ('PROCEDURE','FUNCTION','PACKAGE','PACKAGE BODY','TRIGGER')
       ORDER BY name, type, line`,
      want("StoredProcedure", "Function", "Package", "PackageBody", "Trigger")
    );
    const seqs = await run(
      `SELECT sequence_name, min_value, max_value, increment_by, cycle_flag FROM ${p}_sequences WHERE sequence_owner = :o`,
      want("Sequence")
    );
    const syns = await run(`SELECT synonym_name, table_owner, table_name, db_link FROM ${p}_synonyms WHERE owner = :o`, want("Synonym"));

    const tableSet = new Set(tables.map((t) => t.TABLE_NAME as string));
    const identSet = new Set(identity.map((r) => `${r.TABLE_NAME}.${r.COLUMN_NAME}`));

    // ---- constraints
    const consByName = groupBy(cons, (r) => r.CONSTRAINT_NAME);
    const consIndexNames = new Set<string>();
    const pkOrUq = new Map<string, { table: string; cols: string[] }>();
    const pkByTable = new Map<string, { name: string; clustered: boolean; columns: string[] }>();
    for (const [name, rows] of consByName) {
      const r0 = rows[0];
      if (r0.INDEX_NAME) consIndexNames.add(r0.INDEX_NAME);
      if (r0.CONSTRAINT_TYPE === "P" || r0.CONSTRAINT_TYPE === "U")
        pkOrUq.set(name, { table: r0.TABLE_NAME, cols: rows.map((r) => r.COLUMN_NAME) });
    }

    for (const [name, rows] of consByName) {
      const r0 = rows[0];
      const cols = rows.map((r) => r.COLUMN_NAME).filter(Boolean) as string[];
      const disabled = r0.STATUS === "DISABLED" ? " [DISABLED]" : "";
      if (r0.CONSTRAINT_TYPE === "P") {
        pkByTable.set(r0.TABLE_NAME, { name, clustered: false, columns: cols });
        if (wanted.has("PrimaryKey"))
          objects.push({
            type: "PrimaryKey",
            schema: owner,
            parent: r0.TABLE_NAME,
            name: "PK",
            def: `PRIMARY KEY (${cols.join(", ")})${disabled}`,
            meta: { table: `${owner}.${r0.TABLE_NAME}`, constraintName: name, clustered: false, columns: cols },
          });
      } else if (r0.CONSTRAINT_TYPE === "U" && wanted.has("UniqueConstraint")) {
        objects.push({
          type: "UniqueConstraint",
          schema: owner,
          parent: r0.TABLE_NAME,
          name: SYS_NAME.test(name) ? `UQ(${cols.join(",")})` : name,
          def: `UNIQUE (${cols.join(", ")})${disabled}`,
          meta: { table: `${owner}.${r0.TABLE_NAME}`, constraintName: name, clustered: false, columns: cols },
        });
      } else if (r0.CONSTRAINT_TYPE === "R" && wanted.has("ForeignKey")) {
        const ref = pkOrUq.get(r0.R_CONSTRAINT_NAME);
        const refTable = ref ? `${r0.R_OWNER}.${ref.table}` : `${r0.R_OWNER}.${r0.R_CONSTRAINT_NAME}`;
        const refCols = ref ? ref.cols : [];
        objects.push({
          type: "ForeignKey",
          schema: owner,
          parent: r0.TABLE_NAME,
          name: SYS_NAME.test(name) ? `FK(${cols.join(",")})->${refTable}` : name,
          def: `(${cols.join(", ")}) REFERENCES ${refTable} (${refCols.join(", ")}) ON DELETE ${r0.DELETE_RULE}${disabled}`,
          meta: { table: `${owner}.${r0.TABLE_NAME}`, constraintName: name, columns: cols, refTable, refColumns: refCols, onDelete: r0.DELETE_RULE },
        });
      } else if (r0.CONSTRAINT_TYPE === "C" && wanted.has("CheckConstraint")) {
        const cond = String(r0.SEARCH_CONDITION || "").trim();
        if (/^"?\w+"? IS NOT NULL$/i.test(cond)) continue; // NOT NULL is part of the column
        objects.push({
          type: "CheckConstraint",
          schema: owner,
          parent: r0.TABLE_NAME,
          name: SYS_NAME.test(name) ? `CK ${cond.slice(0, 60)}` : name,
          def: `CHECK (${cond})${disabled}`,
          meta: { table: `${owner}.${r0.TABLE_NAME}`, constraintName: name, definition: `(${cond})` },
        });
      }
    }

    // ---- tables & columns
    const colsByTable = groupBy(columns.filter((r) => tableSet.has(r.TABLE_NAME)), (r) => r.TABLE_NAME);
    for (const t of tableSet) {
      const cols: ColumnMeta[] = (colsByTable.get(t) || []).map((r) => ({
        name: r.COLUMN_NAME,
        dataType: oracleType(r),
        nullable: r.NULLABLE === "Y",
        identity: identSet.has(`${t}.${r.COLUMN_NAME}`) ? { seed: "1", increment: "1" } : null,
        defaultValue: r.DATA_DEFAULT != null && !identSet.has(`${t}.${r.COLUMN_NAME}`) ? String(r.DATA_DEFAULT).trim() : null,
      }));
      if (wanted.has("Table"))
        objects.push({ type: "Table", schema: owner, name: t, def: "", meta: { columns: cols, pk: pkByTable.get(t) || null } });
      if (wanted.has("Column"))
        for (const col of cols) {
          let d = `${col.dataType} ${col.nullable ? "NULL" : "NOT NULL"}`;
          if (col.identity) d += " GENERATED AS IDENTITY";
          if (col.defaultValue) d += ` DEFAULT ${col.defaultValue}`;
          objects.push({ type: "Column", schema: owner, parent: t, name: col.name, def: d, meta: { table: `${owner}.${t}`, ...col } });
        }
    }

    // ---- indexes (skip the ones that back a PK / unique constraint)
    for (const rows of groupBy(idx, (r) => r.INDEX_NAME).values()) {
      const r0 = rows[0];
      if (consIndexNames.has(r0.INDEX_NAME)) continue;
      const keyCols = rows.map((r) => `${r.COLUMN_NAME}${r.DESCEND === "DESC" ? " DESC" : ""}`);
      objects.push({
        type: "Index",
        schema: owner,
        parent: r0.TABLE_NAME,
        name: r0.INDEX_NAME,
        def: `${r0.UNIQUENESS === "UNIQUE" ? "UNIQUE " : ""}${r0.INDEX_TYPE} (${keyCols.join(", ")})`,
        meta: { table: `${owner}.${r0.TABLE_NAME}`, unique: r0.UNIQUENESS === "UNIQUE", kind: r0.INDEX_TYPE, columns: keyCols, include: [] },
      });
    }

    // ---- views
    for (const v of views)
      objects.push({
        type: "View",
        schema: owner,
        name: v.VIEW_NAME,
        def: `CREATE OR REPLACE VIEW ${v.VIEW_NAME} AS\n${String(v.TEXT || "").trim()}`,
        code: true,
      });

    // ---- procedures / functions / packages / triggers
    for (const rows of groupBy(source, (r) => `${r.TYPE}|${r.NAME}`).values()) {
      const r0 = rows[0];
      const type = SOURCE_TYPES[r0.TYPE];
      if (!type || !wanted.has(type)) continue;
      const text = rows.map((r) => String(r.TEXT ?? "")).join("").replace(/\n$/, "");
      objects.push({ type, schema: owner, name: r0.NAME, def: `CREATE OR REPLACE ${text}`, code: true });
    }

    for (const s of seqs)
      objects.push({
        type: "Sequence",
        schema: owner,
        name: s.SEQUENCE_NAME,
        def: `INCREMENT BY ${s.INCREMENT_BY} MINVALUE ${s.MIN_VALUE} MAXVALUE ${s.MAX_VALUE}${s.CYCLE_FLAG === "Y" ? " CYCLE" : ""}`,
      });
    for (const s of syns) {
      const base = `${s.TABLE_OWNER ? s.TABLE_OWNER + "." : ""}${s.TABLE_NAME}${s.DB_LINK ? "@" + s.DB_LINK : ""}`;
      objects.push({ type: "Synonym", schema: owner, name: s.SYNONYM_NAME, def: `FOR ${base}`, meta: { base } });
    }
  } finally {
    await conn.close();
  }

  return { engine: "oracle", label: c.label, objects, warnings, extractedAt: new Date().toISOString() };
}
