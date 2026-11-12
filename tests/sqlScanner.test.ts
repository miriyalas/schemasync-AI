import { describe, expect, it } from "vitest";
import { displaySql, normalizeSql, scanSql, unquoteIdent } from "@/lib/sqlScanner";

const both = { ignoreWhitespace: true, ignoreCase: true };

describe("scanSql", () => {
  it("splits code, strings, comments and identifiers", () => {
    const segs = scanSql("SELECT [Name], 'it''s' -- note\nFROM \"T\" /* c */");
    expect(segs.map((s) => s.kind)).toEqual(["code", "ident", "code", "string", "code", "comment", "code", "ident", "code", "comment"]);
    expect(segs.find((s) => s.kind === "string")!.text).toBe("'it''s'");
  });

  it("recognises N'unicode' strings but not identifiers ending in N", () => {
    expect(scanSql("SELECT N'x'").some((s) => s.kind === "string" && s.text === "N'x'")).toBe(true);
    const segs = scanSql("SELECT colN'x'");
    expect(segs.find((s) => s.kind === "string")!.text).toBe("'x'");
  });

  it("handles unterminated strings and comments without throwing", () => {
    expect(scanSql("SELECT 'abc").at(-1)!.kind).toBe("string");
    expect(scanSql("SELECT 1 /* open").at(-1)!.kind).toBe("comment");
  });

  it("handles ]] escapes inside bracket identifiers", () => {
    const segs = scanSql("SELECT [a]]b] FROM t");
    expect(segs[1]).toEqual({ kind: "ident", text: "[a]]b]" });
    expect(unquoteIdent("[a]]b]")).toBe("a]b");
    expect(unquoteIdent('"X"')).toBe("X");
    expect(unquoteIdent("plain")).toBe("plain");
  });
});

describe("normalizeSql", () => {
  it("treats whitespace, comments, case and brackets as equal", () => {
    const a = "CREATE PROCEDURE [dbo].[GetX]\n  @Id INT\nAS\n-- comment\nSELECT * FROM t WHERE id = @Id;";
    const b = "create   proc dbo.GetX @Id int as /* other */ select * from T where ID=@id\nGO";
    expect(normalizeSql(a, both)).toBe(normalizeSql(b, both));
  });

  it("treats CREATE OR ALTER and CREATE OR REPLACE like CREATE", () => {
    expect(normalizeSql("CREATE OR ALTER VIEW v AS SELECT 1", both)).toBe(normalizeSql("CREATE VIEW v AS SELECT 1", both));
    expect(normalizeSql("CREATE OR REPLACE VIEW v AS SELECT 1", both)).toBe(normalizeSql("CREATE VIEW v AS SELECT 1", both));
  });

  it("keeps string literal contents exactly (case and spaces)", () => {
    expect(normalizeSql("SELECT 'A  b'", both)).not.toBe(normalizeSql("SELECT 'a b'", both));
  });

  it("detects real logic changes", () => {
    expect(normalizeSql("SELECT a FROM t WHERE x = 1", both)).not.toBe(normalizeSql("SELECT a FROM t WHERE x = 2", both));
  });

  it("respects options when turned off", () => {
    const strict = { ignoreWhitespace: false, ignoreCase: false };
    expect(normalizeSql("SELECT  a", strict)).not.toBe(normalizeSql("SELECT a", strict));
    expect(normalizeSql("select a", strict)).not.toBe(normalizeSql("SELECT a", strict));
    expect(normalizeSql("SELECT a -- x", strict)).toContain("-- x");
  });
});

describe("displaySql", () => {
  it("unifies line endings and trims trailing spaces and blank edges", () => {
    expect(displaySql("\r\nSELECT 1   \r\nFROM t  \n\n")).toBe("SELECT 1\nFROM t");
  });
});
