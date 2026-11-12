import sql from "mssql";
import type { ColumnMeta, ConnectionInput, DbObject, ObjectType, Snapshot } from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function config(c: ConnectionInput): sql.config {
  return {
    server: c.host,
    port: c.port || 1433,
    database: c.database,
    user: c.user,
    password: c.password,
    options: {
      encrypt: c.encrypt ?? true,
      trustServerCertificate: c.trustServerCertificate ?? true,
      appName: "SchemaSync AI",
    },
    pool: { max: 6, min: 0, idleTimeoutMillis: 5000 },
    connectionTimeout: 15000,
    requestTimeout: 55000,
  };
}

export async function testSqlServer(c: ConnectionInput) {
  const pool = await new sql.ConnectionPool(config(c)).connect();
  try {
    const r = await pool
      .request()
      .query(
        "SELECT @@VERSION AS version, DB_NAME() AS db, HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW DEFINITION') AS canView"
      );
    const row = r.recordset[0] || {};
    return {
      ok: true,
      version: String(row.version || "").split("\n")[0].trim(),
      database: row.db as string,
      canViewDefinition: row.canView === 1,
    };
  } finally {
    await pool.close();
  }
}

/** Formats a SQL Server type the way you would write it in DDL. */
export function sqlServerType(typ: string, maxLength: number, precision: number, scale: number): string {
  const t = String(typ).toLowerCase();
  if (["varchar", "char", "varbinary", "binary"].includes(t)) return `${t}(${maxLength === -1 ? "max" : maxLength})`;
  if (["nvarchar", "nchar"].includes(t)) return `${t}(${maxLength === -1 ? "max" : maxLength / 2})`;
  if (["decimal", "numeric"].includes(t)) return `${t}(${precision},${scale})`;
  if (["datetime2", "time", "datetimeoffset"].includes(t)) return `${t}(${scale})`;
  if (t === "float") return precision === 53 ? "float" : `float(${precision})`;
  return t;
}

const AUTO_NAME = /^(PK|UQ|FK|CK|DF)__.+__[0-9A-F]{8,16}$/i;

const Q = {
  tables: `SELECT s.name AS sch, t.name AS tbl FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE t.is_ms_shipped = 0`,
  columns: `SELECT s.name AS sch, t.name AS tbl, c.name AS col, c.column_id AS ord, ty.name AS typ, c.max_length, c.precision, c.scale,
      c.is_nullable, c.is_identity, CAST(ic.seed_value AS varchar(40)) AS seed, CAST(ic.increment_value AS varchar(40)) AS incr,
      dc.definition AS def_value, cc.definition AS computed
    FROM sys.columns c
    JOIN sys.tables t ON t.object_id = c.object_id
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    LEFT JOIN sys.identity_columns ic ON ic.object_id = c.object_id AND ic.column_id = c.column_id
    LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
    LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
    WHERE t.is_ms_shipped = 0
    ORDER BY s.name, t.name, c.column_id`,
  keys: `SELECT s.name AS sch, t.name AS tbl, kc.name AS kname, kc.type AS ktype, i.type_desc AS idx_type,
      col.name AS col, ic.key_ordinal AS ord, ic.is_descending_key AS descd
    FROM sys.key_constraints kc
    JOIN sys.tables t ON t.object_id = kc.parent_object_id
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    JOIN sys.indexes i ON i.object_id = kc.parent_object_id AND i.index_id = kc.unique_index_id
    JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    JOIN sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id
    WHERE t.is_ms_shipped = 0
    ORDER BY s.name, t.name, kc.name, ic.key_ordinal`,
  fks: `SELECT fk.name AS fkname, s.name AS sch, t.name AS tbl, rs.name AS rsch, rt.name AS rtbl, pc.name AS col, rc.name AS rcol,
      fkc.constraint_column_id AS ord, fk.delete_referential_action_desc AS del, fk.update_referential_action_desc AS upd, fk.is_disabled
    FROM sys.foreign_keys fk
    JOIN sys.tables t ON t.object_id = fk.parent_object_id
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
    JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
    JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
    JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
    WHERE t.is_ms_shipped = 0
    ORDER BY s.name, t.name, fk.name, fkc.constraint_column_id`,
  checks: `SELECT s.name AS sch, t.name AS tbl, cc.name AS cname, cc.definition, cc.is_disabled
    FROM sys.check_constraints cc
    JOIN sys.tables t ON t.object_id = cc.parent_object_id
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE t.is_ms_shipped = 0`,
  indexes: `SELECT s.name AS sch, t.name AS tbl, i.name AS iname, i.type_desc, i.is_unique, i.filter_definition,
      col.name AS col, ic.key_ordinal, ic.is_included_column, ic.is_descending_key, ic.index_column_id
    FROM sys.indexes i
    JOIN sys.tables t ON t.object_id = i.object_id
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    JOIN sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id
    WHERE t.is_ms_shipped = 0 AND i.is_primary_key = 0 AND i.is_unique_constraint = 0 AND i.type > 0 AND i.is_hypothetical = 0
    ORDER BY s.name, t.name, i.name, ic.key_ordinal, ic.index_column_id`,
  modules: `SELECT s.name AS sch, o.name AS obj, o.type, m.definition, po.name AS parent_obj, ps.name AS parent_sch
    FROM sys.sql_modules m
    JOIN sys.objects o ON o.object_id = m.object_id
    JOIN sys.schemas s ON s.schema_id = o.schema_id
    LEFT JOIN sys.objects po ON po.object_id = o.parent_object_id AND o.type = 'TR'
    LEFT JOIN sys.schemas ps ON ps.schema_id = po.schema_id
    WHERE o.is_ms_shipped = 0 AND o.type IN ('P','V','FN','IF','TF','TR')`,
  tableTypes: `SELECT s.name AS sch, tt.name AS ttname, c.name AS col, c.column_id, ty.name AS typ, c.max_length, c.precision, c.scale, c.is_nullable
    FROM sys.table_types tt
    JOIN sys.schemas s ON s.schema_id = tt.schema_id
    JOIN sys.columns c ON c.object_id = tt.type_table_object_id
    JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    ORDER BY s.name, tt.name, c.column_id`,
  sequences: `SELECT s.name AS sch, sq.name, TYPE_NAME(sq.user_type_id) AS typ, CAST(sq.start_value AS varchar(50)) AS startv,
      CAST(sq.increment AS varchar(50)) AS inc, sq.is_cycling
    FROM sys.sequences sq JOIN sys.schemas s ON s.schema_id = sq.schema_id`,
  synonyms: `SELECT s.name AS sch, sn.name, sn.base_object_name FROM sys.synonyms sn JOIN sys.schemas s ON s.schema_id = sn.schema_id`,
};

const MODULE_TYPES: Record<string, ObjectType> = {
  P: "StoredProcedure",
  V: "View",
  FN: "Function",
  IF: "Function",
  TF: "Function",
  TR: "Trigger",
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

export function columnDef(c: ColumnMeta): string {
  if (c.computed) return `AS ${c.computed}`;
  let d = `${c.dataType} ${c.nullable ? "NULL" : "NOT NULL"}`;
  if (c.identity) d += ` IDENTITY(${c.identity.seed},${c.identity.increment})`;
  if (c.defaultValue) d += ` DEFAULT ${c.defaultValue}`;
  return d;
}

export async function snapshotSqlServer(c: ConnectionInput, wanted: Set<ObjectType>): Promise<Snapshot> {
  const pool = await new sql.ConnectionPool(config(c)).connect();
  const warnings: string[] = [];
  const objects: DbObject[] = [];
  const want = (...t: ObjectType[]) => t.some((x) => wanted.has(x));
  const run = async (q: string, enabled: boolean): Promise<Row[]> => {
    if (!enabled) return [];
    try {
      return (await pool.request().query(q)).recordset as Row[];
    } catch (e) {
      warnings.push(`Query failed (${(e as Error).message}).`);
      return [];
    }
  };

  try {
    const needTables = want("Table", "Column", "PrimaryKey");
    const [tables, columns, keys, fks, checks, indexes, modules, tableTypes, sequences, synonyms] = await Promise.all([
      run(Q.tables, needTables),
      run(Q.columns, needTables),
      run(Q.keys, needTables || want("UniqueConstraint")),
      run(Q.fks, want("ForeignKey")),
      run(Q.checks, want("CheckConstraint")),
      run(Q.indexes, want("Index")),
      run(Q.modules, want("View", "StoredProcedure", "Function", "Trigger")),
      run(Q.tableTypes, want("TableType", "TableTypeColumn")),
      run(Q.sequences, want("Sequence")),
      run(Q.synonyms, want("Synonym")),
    ]);

    // ---- tables + columns + primary keys
    const colsByTable = groupBy(columns, (r) => `${r.sch}.${r.tbl}`);
    const keysByName = groupBy(keys, (r) => `${r.sch}.${r.tbl}.${r.kname}`);
    const pkByTable = new Map<string, { name: string; clustered: boolean; columns: string[] }>();

    for (const rows of keysByName.values()) {
      const r0 = rows[0];
      const cols = rows.map((r) => `${r.col}${r.descd ? " DESC" : ""}`);
      const clustered = String(r0.idx_type).toUpperCase() === "CLUSTERED";
      if (r0.ktype === "PK") {
        pkByTable.set(`${r0.sch}.${r0.tbl}`, { name: r0.kname, clustered, columns: cols });
        if (wanted.has("PrimaryKey"))
          objects.push({
            type: "PrimaryKey",
            schema: r0.sch,
            parent: r0.tbl,
            name: "PK",
            def: `PRIMARY KEY ${clustered ? "CLUSTERED" : "NONCLUSTERED"} (${cols.join(", ")})`,
            meta: { table: `${r0.sch}.${r0.tbl}`, constraintName: r0.kname, clustered, columns: cols },
          });
      } else if (wanted.has("UniqueConstraint")) {
        objects.push({
          type: "UniqueConstraint",
          schema: r0.sch,
          parent: r0.tbl,
          name: AUTO_NAME.test(r0.kname) ? `UQ(${rows.map((r) => r.col).join(",")})` : r0.kname,
          def: `UNIQUE ${clustered ? "CLUSTERED" : "NONCLUSTERED"} (${cols.join(", ")})`,
          meta: { table: `${r0.sch}.${r0.tbl}`, constraintName: r0.kname, clustered, columns: cols },
        });
      }
    }

    for (const t of tables) {
      const key = `${t.sch}.${t.tbl}`;
      const cols: ColumnMeta[] = (colsByTable.get(key) || []).map((r) => ({
        name: r.col,
        dataType: sqlServerType(r.typ, r.max_length, r.precision, r.scale),
        nullable: !!r.is_nullable,
        identity: r.is_identity ? { seed: String(r.seed ?? 1), increment: String(r.incr ?? 1) } : null,
        defaultValue: r.def_value ?? null,
        computed: r.computed ?? null,
      }));
      if (wanted.has("Table"))
        objects.push({
          type: "Table",
          schema: t.sch,
          name: t.tbl,
          def: "",
          meta: { columns: cols, pk: pkByTable.get(key) || null },
        });
      if (wanted.has("Column"))
        for (const col of cols)
          objects.push({ type: "Column", schema: t.sch, parent: t.tbl, name: col.name, def: columnDef(col), meta: { table: key, ...col } });
    }

    // ---- foreign keys
    for (const rows of groupBy(fks, (r) => `${r.sch}.${r.tbl}.${r.fkname}`).values()) {
      const r0 = rows[0];
      const cols = rows.map((r) => r.col);
      const rcols = rows.map((r) => r.rcol);
      const ref = `${r0.rsch}.${r0.rtbl}`;
      objects.push({
        type: "ForeignKey",
        schema: r0.sch,
        parent: r0.tbl,
        name: AUTO_NAME.test(r0.fkname) ? `FK(${cols.join(",")})->${ref}` : r0.fkname,
        def: `(${cols.join(", ")}) REFERENCES ${ref} (${rcols.join(", ")}) ON DELETE ${String(r0.del).replace(/_/g, " ")} ON UPDATE ${String(r0.upd).replace(/_/g, " ")}${r0.is_disabled ? " [DISABLED]" : ""}`,
        meta: {
          table: `${r0.sch}.${r0.tbl}`,
          constraintName: r0.fkname,
          columns: cols,
          refTable: ref,
          refColumns: rcols,
          onDelete: String(r0.del).replace(/_/g, " "),
          onUpdate: String(r0.upd).replace(/_/g, " "),
        },
      });
    }

    // ---- check constraints
    for (const r of checks) {
      objects.push({
        type: "CheckConstraint",
        schema: r.sch,
        parent: r.tbl,
        name: AUTO_NAME.test(r.cname) ? `CK ${String(r.definition).slice(0, 60)}` : r.cname,
        def: `CHECK ${r.definition}${r.is_disabled ? " [DISABLED]" : ""}`,
        meta: { table: `${r.sch}.${r.tbl}`, constraintName: r.cname, definition: r.definition },
      });
    }

    // ---- indexes
    for (const rows of groupBy(indexes, (r) => `${r.sch}.${r.tbl}.${r.iname}`).values()) {
      const r0 = rows[0];
      const keyCols = rows.filter((r) => !r.is_included_column).map((r) => `${r.col}${r.is_descending_key ? " DESC" : ""}`);
      const incl = rows.filter((r) => r.is_included_column).map((r) => r.col);
      let def = `${r0.is_unique ? "UNIQUE " : ""}${r0.type_desc} (${keyCols.join(", ")})`;
      if (incl.length) def += ` INCLUDE (${incl.join(", ")})`;
      if (r0.filter_definition) def += ` WHERE ${r0.filter_definition}`;
      objects.push({
        type: "Index",
        schema: r0.sch,
        parent: r0.tbl,
        name: r0.iname,
        def,
        meta: {
          table: `${r0.sch}.${r0.tbl}`,
          unique: !!r0.is_unique,
          kind: r0.type_desc,
          columns: keyCols,
          include: incl,
          filter: r0.filter_definition || null,
        },
      });
    }

    // ---- code modules
    let encrypted = 0;
    for (const r of modules) {
      const type = MODULE_TYPES[String(r.type).trim()];
      if (!type || !wanted.has(type)) continue;
      if (r.definition == null) encrypted++;
      objects.push({
        type,
        schema: r.sch,
        name: r.obj,
        def: r.definition ?? "-- definition not available (encrypted or no VIEW DEFINITION permission)",
        code: true,
        meta: type === "Trigger" ? { table: `${r.parent_sch}.${r.parent_obj}` } : undefined,
      });
    }
    if (encrypted) warnings.push(`${encrypted} code object(s) had no readable definition (encrypted or missing VIEW DEFINITION).`);

    // ---- table types
    for (const rows of groupBy(tableTypes, (r) => `${r.sch}.${r.ttname}`).values()) {
      const r0 = rows[0];
      const cols: ColumnMeta[] = rows.map((r) => ({
        name: r.col,
        dataType: sqlServerType(r.typ, r.max_length, r.precision, r.scale),
        nullable: !!r.is_nullable,
      }));
      if (wanted.has("TableType"))
        objects.push({
          type: "TableType",
          schema: r0.sch,
          name: r0.ttname,
          def: cols.map((c) => `${c.name} ${c.dataType} ${c.nullable ? "NULL" : "NOT NULL"}`).join(",\n"),
          meta: { columns: cols },
        });
      if (wanted.has("TableTypeColumn"))
        for (const c2 of cols)
          objects.push({
            type: "TableTypeColumn",
            schema: r0.sch,
            parent: r0.ttname,
            name: c2.name,
            def: `${c2.dataType} ${c2.nullable ? "NULL" : "NOT NULL"}`,
          });
    }

    for (const r of sequences)
      objects.push({
        type: "Sequence",
        schema: r.sch,
        name: r.name,
        def: `AS ${r.typ} START WITH ${r.startv} INCREMENT BY ${r.inc}${r.is_cycling ? " CYCLE" : ""}`,
      });
    for (const r of synonyms)
      objects.push({ type: "Synonym", schema: r.sch, name: r.name, def: `FOR ${r.base_object_name}`, meta: { base: r.base_object_name } });
  } finally {
    await pool.close();
  }

  return { engine: "sqlserver", label: c.label, objects, warnings, extractedAt: new Date().toISOString() };
}
