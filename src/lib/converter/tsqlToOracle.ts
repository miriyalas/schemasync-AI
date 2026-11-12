import { ChangeLog, END, STR, replaceCalls, rule } from "./helpers";

export const TSQL_PROCEDURAL =
  /\b(CREATE|ALTER)\s+(OR\s+ALTER\s+)?(PROC|PROCEDURE|FUNCTION|TRIGGER)\b|\bDECLARE\s+@|\bBEGIN\s+TRY\b|\bWHILE\b|\bCURSOR\b|\bEXEC(UTE)?\b|\bRAISERROR\b|\bTHROW\b|#\w|@@\w|\bOUTPUT\b|\bMERGE\b/i;

const STMT_START = /^(END|BEGIN|IF|ELSE|RETURN|INSERT|UPDATE|DELETE|DECLARE|SET|EXEC|EXECUTE|WHILE|COMMIT|ROLLBACK|UNION|EXCEPT|INTERSECT|GO|SELECT|PRINT)$/i;

/** SELECT TOP n … → SELECT … FETCH FIRST n ROWS ONLY */
function topToFetch(text: string, log: ChangeLog): string {
  const re = /\bSELECT(\s+DISTINCT)?\s+TOP\s*(?:\(\s*([^)]+?)\s*\)|(\d+))(\s+PERCENT)?(\s+WITH\s+TIES)?/i;
  let t = text;
  for (let guard = 0; guard < 500; guard++) {
    const m = re.exec(t);
    if (!m) break;
    const n = (m[2] || m[3]).trim();
    const head = `SELECT${m[1] || ""}`;
    t = t.slice(0, m.index) + head + t.slice(m.index + m[0].length);
    // find the end of this SELECT statement
    let depth = 0;
    let caseDepth = 0;
    let end = t.length;
    for (let i = m.index + head.length; i < t.length; i++) {
      const ch = t[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        if (depth === 0) {
          end = i;
          break;
        }
        depth--;
      } else if (depth === 0) {
        if (ch === ";") {
          end = i;
          break;
        }
        if (/\w/.test(ch) && !/[\w@#$]/.test(t[i - 1] || "")) {
          const word = (/^\w+/.exec(t.slice(i)) || [""])[0].toUpperCase();
          if (word === "CASE") caseDepth++;
          else if (word === "END" && caseDepth > 0) caseDepth--;
          else if (caseDepth === 0 && STMT_START.test(word)) {
            end = i;
            break;
          }
          i += word.length - 1;
        }
      }
    }
    let ins = end;
    while (ins > 0 && /\s/.test(t[ins - 1])) ins--;
    const lineStart = t.lastIndexOf("\n", m.index) + 1;
    const indent = (t.slice(lineStart, m.index).match(/^\s*/) || [""])[0];
    const multiLine = t.slice(m.index, ins).includes("\n");
    const clause = `FETCH FIRST ${n}${m[4] ? " PERCENT" : ""} ROWS ${m[5] ? "WITH TIES" : "ONLY"}`;
    t = t.slice(0, ins) + (multiLine ? `\n${indent}${clause}` : ` ${clause}`) + t.slice(ins);
    log.add(`TOP ${n}`, clause);
  }
  return t;
}

const DATEADD: Record<string, (n: string, d: string) => string> = {
  day: (n, d) => `(${d} + ${n})`,
  month: (n, d) => `ADD_MONTHS(${d}, ${n})`,
  year: (n, d) => `ADD_MONTHS(${d}, 12 * (${n}))`,
  week: (n, d) => `(${d} + 7 * (${n}))`,
  hour: (n, d) => `(${d} + (${n}) / 24)`,
  minute: (n, d) => `(${d} + (${n}) / 1440)`,
  second: (n, d) => `(${d} + (${n}) / 86400)`,
};
const DATEDIFF: Record<string, (a: string, b: string) => string> = {
  day: (a, b) => `(TRUNC(${b}) - TRUNC(${a}))`,
  month: (a, b) => `TRUNC(MONTHS_BETWEEN(${b}, ${a}))`,
  year: (a, b) => `TRUNC(MONTHS_BETWEEN(${b}, ${a}) / 12)`,
  hour: (a, b) => `ROUND((${b} - ${a}) * 24)`,
  minute: (a, b) => `ROUND((${b} - ${a}) * 1440)`,
  second: (a, b) => `ROUND((${b} - ${a}) * 86400)`,
};
const PART_ALIAS: Record<string, string> = {
  dd: "day", d: "day", day: "day",
  mm: "month", m: "month", month: "month",
  yy: "year", yyyy: "year", year: "year",
  wk: "week", ww: "week", week: "week",
  hh: "hour", hour: "hour",
  mi: "minute", n: "minute", minute: "minute",
  ss: "second", s: "second", second: "second",
};

export function tsqlToOracle(input: string, log: ChangeLog, procedural: boolean): string {
  let t = input;

  t = rule(t, log, /^[ \t]*GO[ \t]*$/gim, "/", "GO", "/");
  t = rule(t, log, /^[ \t]*SET\s+NOCOUNT\s+(ON|OFF)\s*;?[ \t]*\n?/gim, "", "SET NOCOUNT ON", "(removed, no equivalent)");
  t = rule(t, log, /\s*WITH\s*\(\s*NOLOCK\s*\)/gi, "", "WITH (NOLOCK)", "(removed, Oracle reads never block)");
  t = rule(
    t,
    log,
    /\b(?:CREATE\s+OR\s+ALTER|CREATE|ALTER)\s+(PROC|PROCEDURE|FUNCTION|VIEW|TRIGGER)\b/gi,
    (_m, kind) => `CREATE OR REPLACE ${kind.toUpperCase() === "PROC" ? "PROCEDURE" : kind.toUpperCase()}`,
    "CREATE / ALTER",
    "CREATE OR REPLACE"
  );
  t = rule(t, log, /\bdbo\./gi, "", "dbo.", "(schema prefix removed)");

  // ---- functions
  const call = (name: string, fn: (a: string[]) => string | null, from: string, to: string) => {
    const r = replaceCalls(t, name, fn);
    if (r.count) log.add(from, to);
    t = r.text;
  };
  call("ISNULL", (a) => (a.length === 2 ? `NVL(${a[0]}, ${a[1]})` : null), "ISNULL()", "NVL()");
  call("LEN", (a) => `LENGTH(${a[0]})`, "LEN()", "LENGTH()");
  call("SUBSTRING", (a) => `SUBSTR(${a.join(", ")})`, "SUBSTRING()", "SUBSTR()");
  call("CHARINDEX", (a) => `INSTR(${[a[1], a[0], ...a.slice(2)].join(", ")})`, "CHARINDEX(a, b)", "INSTR(b, a)");
  call("GETDATE", () => "SYSDATE", "GETDATE()", "SYSDATE");
  call("SYSDATETIME", () => "SYSTIMESTAMP", "SYSDATETIME()", "SYSTIMESTAMP");
  call("GETUTCDATE", () => "SYS_EXTRACT_UTC(SYSTIMESTAMP)", "GETUTCDATE()", "SYS_EXTRACT_UTC(SYSTIMESTAMP)");
  call("NEWID", () => "SYS_GUID()", "NEWID()", "SYS_GUID()");
  call("IIF", (a) => (a.length === 3 ? `CASE WHEN ${a[0]} THEN ${a[1]} ELSE ${a[2]} END` : null), "IIF()", "CASE WHEN … END");
  for (const p of ["YEAR", "MONTH", "DAY"])
    call(p, (a) => (a.length === 1 ? `EXTRACT(${p} FROM ${a[0]})` : null), `${p}()`, `EXTRACT(${p} FROM …)`);
  call(
    "DATEADD",
    (a) => {
      const f = DATEADD[PART_ALIAS[a[0]?.toLowerCase()]];
      if (!f || a.length !== 3) {
        log.warn(`DATEADD with part "${a[0]}" was not converted.`);
        return null;
      }
      return f(a[1], a[2]);
    },
    "DATEADD()",
    "date arithmetic / ADD_MONTHS"
  );
  call(
    "DATEDIFF",
    (a) => {
      const f = DATEDIFF[PART_ALIAS[a[0]?.toLowerCase()]];
      if (!f || a.length !== 3) {
        log.warn(`DATEDIFF with part "${a[0]}" was not converted.`);
        return null;
      }
      if (PART_ALIAS[a[0].toLowerCase()] !== "day") log.warn("DATEDIFF by month/year counts boundaries in SQL Server; MONTHS_BETWEEN counts whole months. Check edge dates.");
      return f(a[1], a[2]);
    },
    "DATEDIFF()",
    "date subtraction / MONTHS_BETWEEN"
  );
  call(
    "CONVERT",
    (a) => {
      if (a.length < 2) return null;
      const type = a[0].trim();
      if (a.length > 2) log.warn("CONVERT with a style code: check the date/number format in TO_CHAR.");
      if (/^n?(var)?char/i.test(type)) return `TO_CHAR(${a[1]})`;
      if (/^date$/i.test(type)) return `TRUNC(CAST(${a[1]} AS DATE))`;
      return `CAST(${a[1]} AS ${type})`;
    },
    "CONVERT()",
    "TO_CHAR() / CAST()"
  );
  t = rule(t, log, /@@ROWCOUNT\b/gi, "SQL%ROWCOUNT", "@@ROWCOUNT", "SQL%ROWCOUNT");
  t = rule(t, log, /\bPRINT\s+([^;\n]+)/gi, "DBMS_OUTPUT.PUT_LINE($1)", "PRINT", "DBMS_OUTPUT.PUT_LINE");
  t = rule(t, log, /\bBEGIN\s+TRAN(SACTION)?\b\s*;?/gi, "", "BEGIN TRAN", "(removed, Oracle starts transactions implicitly)");
  t = rule(t, log, /\bCOMMIT\s+TRAN(SACTION)?\b/gi, "COMMIT", "COMMIT TRAN", "COMMIT");
  t = rule(t, log, /\bROLLBACK\s+TRAN(SACTION)?\b/gi, "ROLLBACK", "ROLLBACK TRAN", "ROLLBACK");

  // ---- string concatenation: + next to a string literal → ||
  const strAt = `${STR}\\d+${END}`;
  t = rule(t, log, new RegExp(`(${strAt})\\s*\\+`, "g"), "$1 ||", "+ (string join)", "||");
  t = rule(t, log, new RegExp(`\\+\\s*(?=${strAt})`, "g"), "|| ", "+ (string join)", "||");
  if (/\+/.test(t) && /\|\|/.test(t)) log.warn("Some + operators may still join strings (column + column). Check them.");

  t = topToFetch(t, log);

  // ---- data types
  t = rule(t, log, /\b(N?)VARCHAR\s*\(\s*MAX\s*\)/gi, (_m, n) => (n ? "NCLOB" : "CLOB"), "VARCHAR(MAX)", "CLOB / NCLOB");
  t = rule(t, log, /\bVARBINARY\s*\(\s*MAX\s*\)/gi, "BLOB", "VARBINARY(MAX)", "BLOB");
  t = rule(t, log, /\bVARBINARY\s*\(\s*(\d+)\s*\)/gi, "RAW($1)", "VARBINARY(n)", "RAW(n)");
  t = rule(t, log, /\bNVARCHAR\s*\(/gi, "NVARCHAR2(", "NVARCHAR", "NVARCHAR2");
  t = rule(t, log, /\bVARCHAR\s*\(/gi, "VARCHAR2(", "VARCHAR", "VARCHAR2");
  t = rule(t, log, /\bSYSNAME\b/gi, "NVARCHAR2(128)", "SYSNAME", "NVARCHAR2(128)");
  t = rule(t, log, /\bNTEXT\b/gi, "NCLOB", "NTEXT", "NCLOB");
  t = rule(t, log, /\bUNIQUEIDENTIFIER\b/gi, "RAW(16)", "UNIQUEIDENTIFIER", "RAW(16)");
  t = rule(t, log, /\bDATETIMEOFFSET\b(\s*\(\s*\d\s*\))?/gi, "TIMESTAMP WITH TIME ZONE", "DATETIMEOFFSET", "TIMESTAMP WITH TIME ZONE");
  t = rule(t, log, /\bDATETIME2(?:\s*\(\s*\d\s*\)|\b)|\bSMALLDATETIME\b|\bDATETIME\b/gi, "TIMESTAMP", "DATETIME / DATETIME2", "TIMESTAMP");
  t = rule(t, log, /(?<![.@\w])BIGINT\b/gi, "NUMBER(19)", "BIGINT", "NUMBER(19)");
  t = rule(t, log, /(?<![.@\w])SMALLINT\b/gi, "NUMBER(5)", "SMALLINT", "NUMBER(5)");
  t = rule(t, log, /(?<![.@\w])TINYINT\b/gi, "NUMBER(3)", "TINYINT", "NUMBER(3)");
  t = rule(t, log, /(?<![.@\w])INT(EGER)?\b/gi, "NUMBER(10)", "INT", "NUMBER(10)");
  t = rule(t, log, /(?<![.@\w])BIT\b/gi, "NUMBER(1)", "BIT", "NUMBER(1)");
  t = rule(t, log, /(?<![.@\w])SMALLMONEY\b/gi, "NUMBER(10,4)", "SMALLMONEY", "NUMBER(10,4)");
  t = rule(t, log, /(?<![.@\w])MONEY\b/gi, "NUMBER(19,4)", "MONEY", "NUMBER(19,4)");
  t = rule(t, log, /\b(DECIMAL|NUMERIC)\s*\(/gi, "NUMBER(", "DECIMAL / NUMERIC", "NUMBER");
  t = rule(t, log, /(?<![.@\w])FLOAT\b(\s*\(\s*\d+\s*\))?/gi, "BINARY_DOUBLE", "FLOAT", "BINARY_DOUBLE");
  t = rule(t, log, /(?<![.@\w])REAL\b/gi, "BINARY_FLOAT", "REAL", "BINARY_FLOAT");
  t = rule(
    t,
    log,
    /\bIDENTITY\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/gi,
    "GENERATED BY DEFAULT AS IDENTITY (START WITH $1 INCREMENT BY $2)",
    "IDENTITY(s,i)",
    "GENERATED BY DEFAULT AS IDENTITY"
  );

  // ---- variables
  if (!procedural) t = rule(t, log, /@([A-Za-z_]\w*)/g, ":$1", "@param", ":param (bind variable)");

  // ---- SELECT without FROM needs DUAL
  if (/\bSELECT\b/i.test(t) && !/\bFROM\b/i.test(t) && !procedural) {
    // insert before a trailing semicolon and trailing comments, never inside a comment
    const tail = /(?:\s*;)?(?:\s*\u0001C\d+\u0001)*\s*$/.exec(t)![0];
    t = t.slice(0, t.length - tail.length).trimEnd() + " FROM DUAL" + tail.replace(/^\s+(?=;)/, "").trimEnd();
    log.add("SELECT expr", "SELECT expr FROM DUAL");
  }

  if (/#\w/.test(t)) log.warn("Temp tables (#name) need a global temporary table or a CTE in Oracle.");
  if (/\bSCOPE_IDENTITY\s*\(|@@IDENTITY/i.test(t)) log.warn("SCOPE_IDENTITY() / @@IDENTITY: use RETURNING … INTO in Oracle.");
  return t;
}
