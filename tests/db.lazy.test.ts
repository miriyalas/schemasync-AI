import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/oracle", () => {
  throw new Error("native module missing");
});
vi.mock("@/lib/db/sqlserver", () => ({
  testSqlServer: vi.fn(async () => ({ ok: true, database: "d" })),
  snapshotSqlServer: vi.fn(async () => ({ engine: "sqlserver", label: "DEV", objects: [], warnings: [], extractedAt: "" })),
}));

import { takeSnapshot, testConnection } from "@/lib/db";

const ss = { engine: "sqlserver" as const, label: "DEV", host: "h", database: "d", user: "u", password: "p" };

describe("lazy driver loading", () => {
  it("loads the SQL Server driver only when used", async () => {
    expect(await testConnection(ss)).toEqual({ ok: true, database: "d" });
    expect((await takeSnapshot(ss, new Set())).engine).toBe("sqlserver");
  });
  it("turns a driver load failure into a clear error", async () => {
    await expect(testConnection({ ...ss, engine: "oracle", serviceName: "S" })).rejects.toThrow(/Could not load the Oracle driver/);
  });
});
