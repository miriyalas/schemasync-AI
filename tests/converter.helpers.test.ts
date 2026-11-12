import { describe, expect, it } from "vitest";
import { ChangeLog, basicValidation, protect, replaceCalls, rule, splitArgs } from "@/lib/converter/helpers";

describe("protect / restore", () => {
  it("hides strings and comments from rules and restores them", () => {
    const p = protect("SELECT 'GETDATE()' -- GETDATE()\n, GETDATE()", "keep");
    expect(p.text).not.toContain("'GETDATE()'");
    const changed = p.text.replace(/GETDATE\(\)/g, "SYSDATE");
    expect(p.restore(changed)).toBe("SELECT 'GETDATE()' -- GETDATE()\n, SYSDATE");
  });

  it("strips simple [brackets] / \"quotes\" but keeps names that need quoting", () => {
    expect(protect("SELECT [Name], [Order Id] FROM \"EMP\"", "strip").text).toBe("SELECT Name, [Order Id] FROM EMP");
    expect(protect("SELECT [Name]", "keep").text).toBe("SELECT [Name]");
  });

  it("normalises CRLF", () => {
    expect(protect("a\r\nb", "keep").text).toBe("a\nb");
  });
});

describe("splitArgs", () => {
  it("splits on top-level commas only", () => {
    expect(splitArgs("a, f(b, c), d")).toEqual(["a", "f(b, c)", "d"]);
    expect(splitArgs("")).toEqual([]);
    expect(splitArgs("x")).toEqual(["x"]);
  });
});

describe("replaceCalls", () => {
  it("replaces calls and passes arguments", () => {
    expect(replaceCalls("SELECT ISNULL(a, 0) FROM t", "ISNULL", (a) => `NVL(${a.join(", ")})`)).toEqual({ text: "SELECT NVL(a, 0) FROM t", count: 1 });
  });
  it("handles nested calls of the same function", () => {
    expect(replaceCalls("ISNULL(ISNULL(a, b), c)", "ISNULL", (a) => `NVL(${a.join(", ")})`).text).toBe("NVL(NVL(a, b), c)");
  });
  it("is case-insensitive and skips qualified names", () => {
    expect(replaceCalls("len(x) + dbo.LEN(y)", "LEN", (a) => `LENGTH(${a[0]})`).text).toBe("LENGTH(x) + dbo.LEN(y)");
  });
  it("leaves the call alone when the callback returns null", () => {
    expect(replaceCalls("F(a)", "F", () => null)).toEqual({ text: "F(a)", count: 0 });
  });
  it("stops safely on unbalanced parentheses", () => {
    expect(replaceCalls("F(a", "F", () => "X").text).toBe("F(a");
  });
});

describe("ChangeLog and rule", () => {
  it("records each change once and only when the rule matched", () => {
    const log = new ChangeLog();
    let t = rule("a INT, b INT", log, /\bINT\b/g, "NUMBER(10)", "INT", "NUMBER(10)");
    t = rule(t, log, /\bBIT\b/g, "NUMBER(1)", "BIT", "NUMBER(1)");
    expect(t).toBe("a NUMBER(10), b NUMBER(10)");
    expect(log.changes).toEqual([{ from: "INT", to: "NUMBER(10)", by: "Rule" }]);
    log.warn("w");
    log.warn("w");
    expect(log.warnings).toEqual(["w"]);
  });
  it("supports $1 groups and function replacements", () => {
    const log = new ChangeLog();
    expect(rule("RAW(8)", log, /RAW\((\d+)\)/g, "VARBINARY($1)", "a", "b")).toBe("VARBINARY(8)");
    expect(rule("x", log, /x/g, () => "y", "x", "y")).toBe("y");
  });
});

describe("basicValidation", () => {
  it("passes balanced SQL", () => {
    expect(basicValidation("SELECT f(a) FROM t WHERE s = ')'").ok).toBe(true);
  });
  it("catches missing and extra parentheses", () => {
    expect(basicValidation("SELECT f(a FROM t").messages[0]).toMatch(/missing \)/);
    expect(basicValidation("SELECT a) FROM t").messages[0]).toMatch(/extra \)/);
  });
  it("catches unterminated strings", () => {
    const v = basicValidation("SELECT 'abc");
    expect(v.ok).toBe(false);
    expect(v.messages.join()).toMatch(/Unterminated/);
  });
});
