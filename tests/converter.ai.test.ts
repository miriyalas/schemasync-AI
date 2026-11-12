import { afterEach, describe, expect, it, vi } from "vitest";
import { convertSql } from "@/lib/converter";

const { chatJson, enabled } = vi.hoisted(() => ({ chatJson: vi.fn(), enabled: { value: true } }));
vi.mock("@/lib/ai", () => ({
  aiConfig: () => ({ provider: "openai", model: "m", enabled: enabled.value }),
  chatJson: (...a: unknown[]) => chatJson(...a),
}));

const SP = "CREATE PROCEDURE p @a INT AS BEGIN TRY SELECT TOP 1 x FROM t END TRY BEGIN CATCH THROW; END CATCH";

afterEach(() => {
  chatJson.mockReset();
  enabled.value = true;
});

describe("convertSql with AI", () => {
  it("returns the same SQL when source and target dialects match", async () => {
    const r = await convertSql("SELECT 1", "oracle", "oracle", true);
    expect(r).toMatchObject({ sql: "SELECT 1", confidence: "High", changes: [] });
    expect(chatJson).not.toHaveBeenCalled();
  });

  it("does not call AI for plain queries", async () => {
    const r = await convertSql("SELECT ISNULL(a,0) FROM t", "sqlserver", "oracle", true);
    expect(chatJson).not.toHaveBeenCalled();
    expect(r).toMatchObject({ usedAI: false, procedural: false, confidence: "High" });
  });

  it("sends procedural code with the rule-based draft and merges AI output", async () => {
    chatJson.mockResolvedValue({
      sql: "```sql\nCREATE OR REPLACE PROCEDURE p (p_a IN NUMBER) AS BEGIN NULL; EXCEPTION WHEN OTHERS THEN RAISE; END;\n```",
      changes: [{ from: "BEGIN TRY", to: "EXCEPTION" }],
      warnings: ["Callers must change"],
      confidence: "Medium",
    });
    const r = await convertSql(SP, "sqlserver", "oracle", true);
    expect(chatJson).toHaveBeenCalledOnce();
    const [system, user] = chatJson.mock.calls[0];
    expect(system).toMatch(/SYS_REFCURSOR/);
    expect(user).toContain("Original (SQL Server T-SQL)");
    expect(user).toContain("FETCH FIRST 1 ROWS ONLY");
    expect(r.usedAI).toBe(true);
    expect(r.sql.startsWith("CREATE OR REPLACE PROCEDURE p (p_a IN NUMBER)")).toBe(true);
    expect(r.changes.some((c) => c.by === "AI" && c.from === "BEGIN TRY")).toBe(true);
    expect(r.changes.some((c) => c.by === "Rule")).toBe(true);
    expect(r.warnings).toContain("Callers must change");
    expect(r.confidence).toBe("Medium");
  });

  it("falls back to the draft when the AI call fails", async () => {
    chatJson.mockRejectedValue(new Error("rate limited"));
    const r = await convertSql(SP, "sqlserver", "oracle", true);
    expect(r.usedAI).toBe(false);
    expect(r.sql).toContain("CREATE OR REPLACE PROCEDURE");
    expect(r.warnings.join()).toMatch(/AI step failed: rate limited/);
  });

  it("ignores an empty AI answer", async () => {
    chatJson.mockResolvedValue({ sql: "  " });
    const r = await convertSql(SP, "sqlserver", "oracle", true);
    expect(r.usedAI).toBe(false);
  });

  it("explains when AI is requested but not configured", async () => {
    enabled.value = false;
    const r = await convertSql(SP, "sqlserver", "oracle", true);
    expect(r.warnings[0]).toMatch(/AI is not configured/);
    expect(r.confidence).toBe("Low");
  });

  it("uses the SQL Server idioms when converting to T-SQL", async () => {
    chatJson.mockResolvedValue({ sql: "CREATE OR ALTER PROCEDURE p AS SELECT 1", confidence: "High" });
    await convertSql("CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;", "oracle", "sqlserver", true);
    expect(chatJson.mock.calls[0][0]).toMatch(/BEGIN TRY/);
  });
});
