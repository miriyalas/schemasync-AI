import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionInput, DbObject, ObjectType } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const state = vi.hoisted(() => ({ cfg: null as any, queries: [] as { q: string; b: any }[], closed: 0, dba: true, rows: {} as Record<string, any[]> }));

vi.mock("oracledb", () => ({
  default: {
    OUT_FORMAT_OBJECT: 4002,
    outFormat: 0,
    fetchArraySize: 0,
    getConnection: async (cfg: any) => {
      state.cfg = cfg;
      return {
        oracleServerVersionString: "19.3.0.0.0",
        close: async () => {
          state.closed++;
        },
        execute: async (q: string, b: any) => {
          state.queries.push({ q, b });
          if (q.includes("dba_objects WHERE ROWNUM") && !state.dba) throw new Error("ORA-00942: table or view does not exist");
          const key = Object.keys(state.rows).find((k) => q.includes(k));
          return { rows: key ? state.rows[key] : [] };
        },
      };
    },
  },
}));

import { oracleType, snapshotOracle, testOracle } from "@/lib/db/oracle";
import { TYPE_GROUPS } from "@/lib/types";

const conn: ConnectionInput = { engine: "oracle", label: "SIT", host: "ora", serviceName: "PDB1", user: "app_ro", password: "pw", schema: "app_sit" };
const ALL = new Set<ObjectType>(TYPE_GROUPS.flatMap((g) => g.types));
const find = (objs: DbObject[], type: ObjectType, name: string) => objs.find((o) => o.type === type && o.name === name)!;

beforeEach(() => {
  Object.assign(state, { cfg: null, queries: [], closed: 0, dba: true });
  state.rows = {
    "v$version": [{ VERSION: "Oracle Database 19c Enterprise Edition" }],
    "COUNT(*) AS N": [{ N: 42 }],
    "_tables WHERE": [{ TABLE_NAME: "ORDERS" }, { TABLE_NAME: "LINES" }],
    "_tab_columns": [
      { TABLE_NAME: "ORDERS", COLUMN_NAME: "ID", DATA_TYPE: "NUMBER", DATA_PRECISION: 10, DATA_SCALE: 0, NULLABLE: "N" },
      { TABLE_NAME: "ORDERS", COLUMN_NAME: "NAME", DATA_TYPE: "VARCHAR2", DATA_LENGTH: 200, CHAR_LENGTH: 50, CHAR_USED: "C", NULLABLE: "Y", DATA_DEFAULT: "'x' " },
      { TABLE_NAME: "LINES", COLUMN_NAME: "ORDER_ID", DATA_TYPE: "NUMBER", DATA_PRECISION: null, DATA_SCALE: null, NULLABLE: "N" },
      { TABLE_NAME: "V_ORDERS", COLUMN_NAME: "ID", DATA_TYPE: "NUMBER", NULLABLE: "Y" },
    ],
    "_tab_identity_cols": [{ TABLE_NAME: "ORDERS", COLUMN_NAME: "ID", GENERATION_TYPE: "BY DEFAULT" }],
    "_constraints c": [
      { CONSTRAINT_NAME: "SYS_C001", CONSTRAINT_TYPE: "P", TABLE_NAME: "ORDERS", COLUMN_NAME: "ID", POSITION: 1, INDEX_NAME: "SYS_C001", STATUS: "ENABLED" },
      { CONSTRAINT_NAME: "UQ_ORDERS_NAME", CONSTRAINT_TYPE: "U", TABLE_NAME: "ORDERS", COLUMN_NAME: "NAME", POSITION: 1, INDEX_NAME: "UQ_ORDERS_NAME", STATUS: "ENABLED" },
      { CONSTRAINT_NAME: "SYS_C002", CONSTRAINT_TYPE: "R", TABLE_NAME: "LINES", COLUMN_NAME: "ORDER_ID", POSITION: 1, R_OWNER: "APP_SIT", R_CONSTRAINT_NAME: "SYS_C001", DELETE_RULE: "CASCADE", STATUS: "ENABLED" },
      { CONSTRAINT_NAME: "SYS_C003", CONSTRAINT_TYPE: "C", TABLE_NAME: "ORDERS", SEARCH_CONDITION: '"ID" IS NOT NULL', STATUS: "ENABLED" },
      { CONSTRAINT_NAME: "CK_NAME", CONSTRAINT_TYPE: "C", TABLE_NAME: "ORDERS", SEARCH_CONDITION: "LENGTH(NAME) > 0", STATUS: "DISABLED" },
    ],
    "_indexes i": [
      { INDEX_NAME: "SYS_C001", TABLE_NAME: "ORDERS", UNIQUENESS: "UNIQUE", INDEX_TYPE: "NORMAL", COLUMN_NAME: "ID", COLUMN_POSITION: 1, DESCEND: "ASC" },
      { INDEX_NAME: "IX_LINES_ORDER", TABLE_NAME: "LINES", UNIQUENESS: "NONUNIQUE", INDEX_TYPE: "NORMAL", COLUMN_NAME: "ORDER_ID", COLUMN_POSITION: 1, DESCEND: "DESC" },
    ],
    "_views": [{ VIEW_NAME: "V_ORDERS", TEXT: "SELECT id FROM orders " }],
    "_source": [
      { NAME: "GET_ORDERS", TYPE: "PROCEDURE", LINE: 1, TEXT: "PROCEDURE get_orders AS\n" },
      { NAME: "GET_ORDERS", TYPE: "PROCEDURE", LINE: 2, TEXT: "BEGIN NULL; END;\n" },
      { NAME: "PKG", TYPE: "PACKAGE", LINE: 1, TEXT: "PACKAGE pkg AS END;" },
      { NAME: "PKG", TYPE: "PACKAGE BODY", LINE: 1, TEXT: "PACKAGE BODY pkg AS END;" },
    ],
    "_sequences": [{ SEQUENCE_NAME: "SEQ_ORDERS", MIN_VALUE: 1, MAX_VALUE: 999, INCREMENT_BY: 1, CYCLE_FLAG: "N" }],
    "_synonyms": [{ SYNONYM_NAME: "REMOTE", TABLE_OWNER: "OTHER", TABLE_NAME: "T", DB_LINK: "LNK" }],
  };
});

describe("oracleType", () => {
  it.each([
    [{ DATA_TYPE: "VARCHAR2", CHAR_LENGTH: 50, CHAR_USED: "C" }, "VARCHAR2(50 CHAR)"],
    [{ DATA_TYPE: "VARCHAR2", CHAR_LENGTH: 50, CHAR_USED: "B" }, "VARCHAR2(50)"],
    [{ DATA_TYPE: "NVARCHAR2", CHAR_LENGTH: 20, CHAR_USED: "C" }, "NVARCHAR2(20)"],
    [{ DATA_TYPE: "NUMBER", DATA_PRECISION: 10, DATA_SCALE: 0 }, "NUMBER(10)"],
    [{ DATA_TYPE: "NUMBER", DATA_PRECISION: 10, DATA_SCALE: 2 }, "NUMBER(10,2)"],
    [{ DATA_TYPE: "NUMBER", DATA_PRECISION: null, DATA_SCALE: 0 }, "NUMBER(*,0)"],
    [{ DATA_TYPE: "NUMBER", DATA_PRECISION: null, DATA_SCALE: null }, "NUMBER"],
    [{ DATA_TYPE: "RAW", DATA_LENGTH: 16 }, "RAW(16)"],
    [{ DATA_TYPE: "FLOAT", DATA_PRECISION: 126 }, "FLOAT(126)"],
    [{ DATA_TYPE: "TIMESTAMP(6)" }, "TIMESTAMP(6)"],
  ])("%j → %s", (row, out) => {
    expect(oracleType(row)).toBe(out);
  });
});

describe("testOracle", () => {
  it("builds the connect string and reports the version", async () => {
    expect(await testOracle(conn)).toEqual({ ok: true, version: "Oracle Database 19c Enterprise Edition", database: "APP_SIT", canViewDefinition: true });
    expect(state.cfg).toEqual({ user: "app_ro", password: "pw", connectString: "ora:1521/PDB1" });
    expect(state.queries.find((x) => x.q.includes("all_objects"))!.b).toEqual({ o: "APP_SIT" });
    expect(state.closed).toBe(1);
  });
});

describe("snapshotOracle", () => {
  it("uses DBA_ views when available and the schema as owner", async () => {
    await snapshotOracle(conn, ALL);
    expect(state.queries.some((x) => x.q.includes("FROM DBA_tables"))).toBe(true);
    expect(state.queries.filter((x) => x.b).every((x) => x.b.o === "APP_SIT")).toBe(true);
  });

  it("falls back to ALL_ views with a warning", async () => {
    state.dba = false;
    const s = await snapshotOracle({ ...conn, schema: undefined }, ALL);
    expect(state.queries.some((x) => x.q.includes("FROM ALL_tables"))).toBe(true);
    expect(s.warnings.join()).toMatch(/ALL_\* views/);
    expect(state.queries.find((x) => x.b)!.b).toEqual({ o: "APP_RO" });
  });

  it("builds tables and columns (views' columns excluded)", async () => {
    const s = await snapshotOracle(conn, ALL);
    expect(s.objects.filter((o) => o.type === "Table").map((o) => o.name).sort()).toEqual(["LINES", "ORDERS"]);
    expect(find(s.objects, "Column", "ID").def).toBe("NUMBER(10) NOT NULL GENERATED AS IDENTITY");
    expect(find(s.objects, "Column", "NAME").def).toBe("VARCHAR2(50 CHAR) NULL DEFAULT 'x'");
    expect(s.objects.some((o) => o.type === "Column" && o.parent === "V_ORDERS")).toBe(false);
  });

  it("maps constraints: system names by columns, NOT NULL checks skipped", async () => {
    const s = await snapshotOracle(conn, ALL);
    expect(find(s.objects, "PrimaryKey", "PK").def).toBe("PRIMARY KEY (ID)");
    expect(find(s.objects, "UniqueConstraint", "UQ_ORDERS_NAME")).toBeTruthy();
    expect(find(s.objects, "ForeignKey", "FK(ORDER_ID)->APP_SIT.ORDERS").def).toBe("(ORDER_ID) REFERENCES APP_SIT.ORDERS (ID) ON DELETE CASCADE");
    const checks = s.objects.filter((o) => o.type === "CheckConstraint");
    expect(checks.map((c) => c.name)).toEqual(["CK_NAME"]);
    expect(checks[0].def).toBe("CHECK (LENGTH(NAME) > 0) [DISABLED]");
  });

  it("skips indexes that back constraints", async () => {
    const s = await snapshotOracle(conn, ALL);
    expect(s.objects.filter((o) => o.type === "Index").map((o) => o.name)).toEqual(["IX_LINES_ORDER"]);
    expect(find(s.objects, "Index", "IX_LINES_ORDER").def).toBe("NORMAL (ORDER_ID DESC)");
  });

  it("joins source lines into CREATE OR REPLACE code objects", async () => {
    const s = await snapshotOracle(conn, ALL);
    expect(find(s.objects, "StoredProcedure", "GET_ORDERS").def).toBe("CREATE OR REPLACE PROCEDURE get_orders AS\nBEGIN NULL; END;");
    expect(find(s.objects, "View", "V_ORDERS").def).toBe("CREATE OR REPLACE VIEW V_ORDERS AS\nSELECT id FROM orders");
    expect(find(s.objects, "Package", "PKG")).toBeTruthy();
    expect(find(s.objects, "PackageBody", "PKG")).toBeTruthy();
  });

  it("builds sequences and synonyms", async () => {
    const s = await snapshotOracle(conn, ALL);
    expect(find(s.objects, "Sequence", "SEQ_ORDERS").def).toBe("INCREMENT BY 1 MINVALUE 1 MAXVALUE 999");
    expect(find(s.objects, "Synonym", "REMOTE").def).toBe("FOR OTHER.T@LNK");
  });

  it("skips queries for unselected types", async () => {
    await snapshotOracle(conn, new Set<ObjectType>(["View"]));
    const ran = state.queries.map((x) => x.q).filter((q) => !q.includes("dba_objects"));
    expect(ran).toHaveLength(1);
    expect(ran[0]).toContain("_views");
  });
});
