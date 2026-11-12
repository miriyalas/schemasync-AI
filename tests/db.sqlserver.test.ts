import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionInput, DbObject, ObjectType } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const state = vi.hoisted(() => ({
  cfg: null as any,
  queries: [] as string[],
  closed: 0,
  connectError: null as string | null,
  failOn: null as string | null,
  rows: {} as Record<string, any[]>,
}));

vi.mock("mssql", () => {
  class ConnectionPool {
    constructor(cfg: any) {
      state.cfg = cfg;
    }
    async connect() {
      if (state.connectError) throw new Error(state.connectError);
      return this;
    }
    request() {
      return {
        query: async (q: string) => {
          state.queries.push(q);
          if (state.failOn && q.includes(state.failOn)) throw new Error("permission denied");
          const key = Object.keys(state.rows).find((k) => q.includes(k));
          return { recordset: key ? state.rows[key] : [] };
        },
      };
    }
    async close() {
      state.closed++;
    }
  }
  return { default: { ConnectionPool } };
});

import { columnDef, snapshotSqlServer, sqlServerType, testSqlServer } from "@/lib/db/sqlserver";
import { TYPE_GROUPS } from "@/lib/types";

const conn: ConnectionInput = { engine: "sqlserver", label: "DEV", host: "db", database: "App", user: "ro", password: "pw" };
const ALL = new Set<ObjectType>(TYPE_GROUPS.flatMap((g) => g.types));
const find = (objs: DbObject[], type: ObjectType, name: string) => objs.find((o) => o.type === type && o.name === name)!;

beforeEach(() => {
  Object.assign(state, { cfg: null, queries: [], closed: 0, connectError: null, failOn: null });
  state.rows = {
    "AS tbl FROM sys.tables": [{ sch: "dbo", tbl: "Orders" }],
    "c.column_id AS ord": [
      { sch: "dbo", tbl: "Orders", col: "Id", typ: "int", max_length: 4, precision: 10, scale: 0, is_nullable: false, is_identity: true, seed: "1", incr: "1" },
      { sch: "dbo", tbl: "Orders", col: "Name", typ: "nvarchar", max_length: 100, precision: 0, scale: 0, is_nullable: true, is_identity: false, def_value: "(N'')" },
      { sch: "dbo", tbl: "Orders", col: "Amount", typ: "decimal", max_length: 9, precision: 18, scale: 2, is_nullable: false, is_identity: false },
      { sch: "dbo", tbl: "Orders", col: "Total", typ: "decimal", max_length: 9, precision: 18, scale: 2, is_nullable: true, is_identity: false, computed: "([Amount]*(2))" },
    ],
    "sys.key_constraints": [
      { sch: "dbo", tbl: "Orders", kname: "PK__Orders__3214EC07A1B2C3D4", ktype: "PK", idx_type: "CLUSTERED", col: "Id", ord: 1, descd: false },
      { sch: "dbo", tbl: "Orders", kname: "UQ_Orders_Name", ktype: "UQ", idx_type: "NONCLUSTERED", col: "Name", ord: 1, descd: true },
      { sch: "dbo", tbl: "Orders", kname: "UQ__Orders__ABCDEF1234567890", ktype: "UQ", idx_type: "NONCLUSTERED", col: "Amount", ord: 1, descd: false },
    ],
    "sys.foreign_keys": [
      { fkname: "FK__Lines__Order__1A2B3C4D", sch: "dbo", tbl: "Lines", rsch: "dbo", rtbl: "Orders", col: "OrderId", rcol: "Id", ord: 1, del: "CASCADE", upd: "NO_ACTION", is_disabled: false },
      { fkname: "FK_Named", sch: "dbo", tbl: "Lines", rsch: "dbo", rtbl: "Orders", col: "OtherId", rcol: "Id", ord: 1, del: "NO_ACTION", upd: "NO_ACTION", is_disabled: true },
    ],
    "sys.check_constraints": [{ sch: "dbo", tbl: "Orders", cname: "CK__Orders__Amount__5AEE82B9", definition: "([Amount]>=(0))", is_disabled: false }],
    is_hypothetical: [
      { sch: "dbo", tbl: "Orders", iname: "IX_Orders_Name", type_desc: "NONCLUSTERED", is_unique: false, filter_definition: "([Name] IS NOT NULL)", col: "Name", key_ordinal: 1, is_included_column: false, is_descending_key: true },
      { sch: "dbo", tbl: "Orders", iname: "IX_Orders_Name", type_desc: "NONCLUSTERED", is_unique: false, filter_definition: "([Name] IS NOT NULL)", col: "Amount", key_ordinal: 0, is_included_column: true, is_descending_key: false },
    ],
    "sys.sql_modules": [
      { sch: "dbo", obj: "GetOrders", type: "P ", definition: "CREATE PROCEDURE dbo.GetOrders AS SELECT 1" },
      { sch: "dbo", obj: "vOrders", type: "V ", definition: "CREATE VIEW dbo.vOrders AS SELECT 1 x" },
      { sch: "dbo", obj: "fnA", type: "IF", definition: "CREATE FUNCTION dbo.fnA() RETURNS TABLE AS RETURN SELECT 1 x" },
      { sch: "dbo", obj: "trgOrders", type: "TR", definition: "CREATE TRIGGER trgOrders ON dbo.Orders AFTER INSERT AS SELECT 1", parent_obj: "Orders", parent_sch: "dbo" },
      { sch: "dbo", obj: "Secret", type: "P ", definition: null },
      { sch: "dbo", obj: "Odd", type: "XX", definition: "?" },
    ],
    "sys.table_types": [
      { sch: "dbo", ttname: "IdList", col: "Id", column_id: 1, typ: "int", max_length: 4, precision: 10, scale: 0, is_nullable: false },
      { sch: "dbo", ttname: "IdList", col: "Note", column_id: 2, typ: "varchar", max_length: -1, precision: 0, scale: 0, is_nullable: true },
    ],
    "sys.sequences": [{ sch: "dbo", name: "SeqOrders", typ: "bigint", startv: "1", inc: "1", is_cycling: true }],
    "sys.synonyms": [{ sch: "dbo", name: "RemoteOrders", base_object_name: "[Other].[dbo].[Orders]" }],
    "@@VERSION": [{ version: "Microsoft SQL Server 2022 (RTM)\n\tCopyright", db: "App", canView: 1 }],
  };
});

describe("sqlServerType", () => {
  it.each([
    [["varchar", 50, 0, 0], "varchar(50)"],
    [["varchar", -1, 0, 0], "varchar(max)"],
    [["nvarchar", 100, 0, 0], "nvarchar(50)"],
    [["nchar", -1, 0, 0], "nchar(max)"],
    [["varbinary", 16, 0, 0], "varbinary(16)"],
    [["decimal", 9, 18, 2], "decimal(18,2)"],
    [["datetime2", 8, 27, 7], "datetime2(7)"],
    [["float", 8, 53, 0], "float"],
    [["float", 4, 24, 0], "float(24)"],
    [["INT", 4, 10, 0], "int"],
  ] as const)("%j → %s", (args, out) => {
    expect(sqlServerType(...(args as unknown as [string, number, number, number]))).toBe(out);
  });
});

describe("columnDef", () => {
  it("formats identity, default and computed columns", () => {
    expect(columnDef({ name: "a", dataType: "int", nullable: false, identity: { seed: "1", increment: "1" } })).toBe("int NOT NULL IDENTITY(1,1)");
    expect(columnDef({ name: "a", dataType: "int", nullable: true, defaultValue: "((0))" })).toBe("int NULL DEFAULT ((0))");
    expect(columnDef({ name: "a", dataType: "int", nullable: true, computed: "(a+b)" })).toBe("AS (a+b)");
  });
});

describe("testSqlServer", () => {
  it("returns version, database and permission", async () => {
    expect(await testSqlServer(conn)).toEqual({ ok: true, version: "Microsoft SQL Server 2022 (RTM)", database: "App", canViewDefinition: true });
    expect(state.closed).toBe(1);
  });
  it("passes safe connection defaults", async () => {
    await testSqlServer(conn);
    expect(state.cfg).toMatchObject({ server: "db", port: 1433, database: "App", user: "ro", options: { encrypt: true, trustServerCertificate: true } });
  });
  it("honours port and TLS settings", async () => {
    await testSqlServer({ ...conn, port: 14330, encrypt: false, trustServerCertificate: false });
    expect(state.cfg).toMatchObject({ port: 14330, options: { encrypt: false, trustServerCertificate: false } });
  });
  it("propagates connection errors", async () => {
    state.connectError = "Login failed for user 'ro'";
    await expect(testSqlServer(conn)).rejects.toThrow(/Login failed/);
  });
});

describe("snapshotSqlServer", () => {
  it("builds tables and columns with full metadata", async () => {
    const s = await snapshotSqlServer(conn, ALL);
    expect(s).toMatchObject({ engine: "sqlserver", label: "DEV", warnings: expect.any(Array) });
    const t = find(s.objects, "Table", "Orders");
    expect((t.meta!.columns as unknown[]).length).toBe(4);
    expect(t.meta!.pk).toMatchObject({ name: "PK__Orders__3214EC07A1B2C3D4", clustered: true, columns: ["Id"] });
    expect(find(s.objects, "Column", "Id").def).toBe("int NOT NULL IDENTITY(1,1)");
    expect(find(s.objects, "Column", "Name").def).toBe("nvarchar(50) NULL DEFAULT (N'')");
    expect(find(s.objects, "Column", "Amount").def).toBe("decimal(18,2) NOT NULL");
    expect(find(s.objects, "Column", "Total").def).toBe("AS ([Amount]*(2))");
    expect(state.closed).toBe(1);
  });

  it("keys auto-named constraints by columns, keeps explicit names", async () => {
    const s = await snapshotSqlServer(conn, ALL);
    expect(find(s.objects, "PrimaryKey", "PK").def).toBe("PRIMARY KEY CLUSTERED (Id)");
    expect(find(s.objects, "UniqueConstraint", "UQ_Orders_Name").def).toBe("UNIQUE NONCLUSTERED (Name DESC)");
    expect(find(s.objects, "UniqueConstraint", "UQ(Amount)")).toBeTruthy();
    const fk = find(s.objects, "ForeignKey", "FK(OrderId)->dbo.Orders");
    expect(fk.def).toBe("(OrderId) REFERENCES dbo.Orders (Id) ON DELETE CASCADE ON UPDATE NO ACTION");
    expect(fk.meta).toMatchObject({ constraintName: "FK__Lines__Order__1A2B3C4D", onDelete: "CASCADE" });
    expect(find(s.objects, "ForeignKey", "FK_Named").def).toContain("[DISABLED]");
    expect(s.objects.find((o) => o.type === "CheckConstraint")!.name).toMatch(/^CK \(\[Amount\]>=\(0\)\)/);
  });

  it("builds index definitions with DESC, INCLUDE and filters", async () => {
    const s = await snapshotSqlServer(conn, ALL);
    expect(find(s.objects, "Index", "IX_Orders_Name").def).toBe("NONCLUSTERED (Name DESC) INCLUDE (Amount) WHERE ([Name] IS NOT NULL)");
  });

  it("maps code modules and warns about unreadable definitions", async () => {
    const s = await snapshotSqlServer(conn, ALL);
    expect(find(s.objects, "StoredProcedure", "GetOrders").code).toBe(true);
    expect(find(s.objects, "View", "vOrders")).toBeTruthy();
    expect(find(s.objects, "Function", "fnA")).toBeTruthy();
    expect(find(s.objects, "Trigger", "trgOrders").meta).toEqual({ table: "dbo.Orders" });
    expect(find(s.objects, "StoredProcedure", "Secret").def).toMatch(/not available/);
    expect(s.objects.some((o) => o.name === "Odd")).toBe(false);
    expect(s.warnings.join()).toMatch(/1 code object/);
  });

  it("builds table types, sequences and synonyms", async () => {
    const s = await snapshotSqlServer(conn, ALL);
    expect(find(s.objects, "TableType", "IdList").def).toBe("Id int NOT NULL,\nNote varchar(max) NULL");
    expect(s.objects.filter((o) => o.type === "TableTypeColumn")).toHaveLength(2);
    expect(find(s.objects, "Sequence", "SeqOrders").def).toBe("AS bigint START WITH 1 INCREMENT BY 1 CYCLE");
    expect(find(s.objects, "Synonym", "RemoteOrders").def).toBe("FOR [Other].[dbo].[Orders]");
  });

  it("only runs the queries for the selected object types", async () => {
    const s = await snapshotSqlServer(conn, new Set<ObjectType>(["StoredProcedure"]));
    expect(state.queries).toHaveLength(1);
    expect(state.queries[0]).toContain("sys.sql_modules");
    expect(s.objects.map((o) => o.type)).toEqual(["StoredProcedure", "StoredProcedure"]);
  });

  it("records a warning and continues when one query fails", async () => {
    state.failOn = "sys.synonyms";
    const s = await snapshotSqlServer(conn, ALL);
    expect(s.warnings.join()).toMatch(/permission denied/);
    expect(find(s.objects, "Table", "Orders")).toBeTruthy();
  });
});
