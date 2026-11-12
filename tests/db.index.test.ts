import { describe, expect, it } from "vitest";
import { friendlyDbError, validateConnection } from "@/lib/db";
import type { ConnectionInput } from "@/lib/types";

const ss: ConnectionInput = { engine: "sqlserver", label: "DEV", host: "h", database: "d", user: "u", password: "p" };
const ora: ConnectionInput = { engine: "oracle", label: "SIT", host: "h", serviceName: "s", user: "u", password: "p" };

describe("validateConnection", () => {
  it("accepts complete connections", () => {
    expect(validateConnection(ss, "Source")).toBeNull();
    expect(validateConnection(ora, "Target")).toBeNull();
  });
  it.each([
    [undefined, /missing/],
    [{ ...ss, host: "" }, /host is required/],
    [{ ...ss, user: "" }, /username is required/],
    [{ ...ss, database: "" }, /database name is required/],
    [{ ...ora, serviceName: "" }, /service name is required/],
  ])("rejects %j", (c, msg) => {
    expect(validateConnection(c as ConnectionInput | undefined, "Source")).toMatch(msg);
  });
});

describe("friendlyDbError", () => {
  it.each([
    ["Failed to connect to h:1433 in 15000ms (ETIMEOUT)", /timeout/],
    ["NJS-510: connection timed out", /timeout/],
    ["getaddrinfo ENOTFOUND db.local", /not found or connection refused/],
    ["Failed to connect to 10.0.0.1:1433 - Could not connect (sequence)", /not found or connection refused/],
    ["Login failed for user 'x'.", /login failed/],
    ["ORA-01017: invalid username/password", /login failed/],
    ["Something odd", /DEV: Something odd/],
  ])("%s", (raw, msg) => {
    expect(friendlyDbError(new Error(raw), "DEV")).toMatch(msg);
  });
  it("never echoes the password and handles non-Error values", () => {
    expect(friendlyDbError("boom", "X")).toBe("X: boom");
  });
});
