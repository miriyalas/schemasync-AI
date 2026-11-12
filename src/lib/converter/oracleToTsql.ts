import { ChangeLog, END, STR, replaceCalls, rule } from "./helpers";

export const ORACLE_PROCEDURAL =
  /\bCREATE\s+(OR\s+REPLACE\s+)?(PROCEDURE|FUNCTION|PACKAGE|TRIGGER|TYPE)\b|\bDECLARE\b|\bBEGIN\b|\bEXCEPTION\b|SYS_REFCURSOR|%TYPE|%ROWTYPE|\bLOOP\b|:=|\bDBMS_\w+|\bEXECUTE\s+IMMEDIATE\b|\bPRAGMA\b|\bBULK\s+COLLECT\b/i;

/** … FETCH FIRST n ROWS ONLY → SELECT TOP (n) … (kept as-is when used with OFFSET, which SQL Server supports). */
function fetchToTop(text: string, log: ChangeLog): string {
  const re = /\s*\bFETCH\s+(?:FIRST|NEXT)\s+(\S+?)\s+(PERCENT\s+)?ROWS?\s+(ONLY|WITH\s+TIES)/gi;
  let t = text;
  let from = 0;
  for (let guard = 0; guard < 500; guard++) {
    re.lastIndex = from;
    const m = re.exec(t);
    if (!m) break;
    if (/\bOFFSET\s+\S+\s+ROWS?\s*$/i.test(t.slice(0, m.index))) {
      from = m.index + m[0].length;
      continue;
    }
    // nearest SELECT at the same bracket depth, searching backwards
    let depth = 0;
    let sel = -1;
    for (let k = m.index - 1; k >= 0; k--) {
      const ch = t[k];
      if (ch === ")") depth++;
      else if (ch === "(") {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && /^SELECT\b/i.test(t.slice(k, k + 7)) && !/\w/.test(t[k - 1] || "")) {
        sel = k;
        break;
      }
    }
    if (sel < 0) {
      from = m.index + m[0].length;
      continue;
    }
    const afterSelect = /^SELECT(\s+DISTINCT)?/i.exec(t.slice(sel))![0];
    const top = ` TOP (${m[1]})${m[2] ? " PERCENT" : ""}${/TIES/i.test(m[3]) ? " WITH TIES" : ""}`;
    t = t.slice(0, m.index) + t.slice(m.index + m[0].length);
    t = t.slice(0, sel + afterSelect.length) + top + t.slice(sel + afterSelect.length);
    log.add(`FETCH FIRST ${m[1]} ROWS ONLY`, `TOP (${m[1]})`);
    from = m.index + top.length;
  }
  return t;
}

function numberType(p: number, s: number): string {
  if (s > 0) return `DECIMAL(${p},${s})`;
  if (p === 1) return "BIT";
  if (p <= 3) return "TINYINT";
  if (p <= 5) return "SMALLINT";
  if (p <= 10) return "INT";
  if (p <= 19) return "BIGINT";
  return `DECIMAL(${p},0)`;
}

export function oracleToTsql(input: string, log: ChangeLog, procedural: boolean): string {
  let t = input;

  t = rule(t, log, /^[ \t]*\/[ \t]*$/gm, "GO", "/", "GO");
  t = rule(
    t,
    log,
    /\bCREATE\s+OR\s+REPLACE\s+(?:(?:NON)?EDITIONABLE\s+)?(PROCEDURE|FUNCTION|VIEW|TRIGGER)\b/gi,
    (_m, kind) => `CREATE OR ALTER ${kind.toUpperCase()}`,
    "CREATE OR REPLACE",
    "CREATE OR ALTER (SQL Server 2016 SP1+)"
  );
  t = rule(t, log, /\s+FROM\s+DUAL\b/gi, "", "FROM DUAL", "(removed)");
  t = rule(t, log, new RegExp(`\\bDATE\\s*(${STR}\\d+${END})`, "gi"), "CAST($1 AS DATE)", "DATE '…' literal", "CAST('…' AS DATE)");
  t = rule(t, log, new RegExp(`\\bTIMESTAMP\\s*(${STR}\\d+${END})`, "gi"), "CAST($1 AS DATETIME2)", "TIMESTAMP '…' literal", "CAST('…' AS DATETIME2)");

  const call = (name: string, fn: (a: string[]) => string | null, from: string, to: string) => {
    const r = replaceCalls(t, name, fn);
    if (r.count) log.add(from, to);
    t = r.text;
  };
  call("NVL2", (a) => (a.length === 3 ? `CASE WHEN ${a[0]} IS NOT NULL THEN ${a[1]} ELSE ${a[2]} END` : null), "NVL2()", "CASE WHEN … END");
  call("NVL", (a) => (a.length === 2 ? `ISNULL(${a[0]}, ${a[1]})` : null), "NVL()", "ISNULL()");
  call("LENGTH", (a) => `LEN(${a[0]})`, "LENGTH()", "LEN()");
  call("SUBSTR", (a) => `SUBSTRING(${a[0]}, ${a[1]}, ${a[2] ?? `LEN(${a[0]})`})`, "SUBSTR()", "SUBSTRING()");
  call(
    "INSTR",
    (a) => {
      if (a.length > 3) {
        log.warn("INSTR with an occurrence argument was not converted.");
        return null;
      }
      return `CHARINDEX(${[a[1], a[0], ...a.slice(2)].join(", ")})`;
    },
    "INSTR(a, b)",
    "CHARINDEX(b, a)"
  );
  call("SYS_GUID", () => "NEWID()", "SYS_GUID()", "NEWID()");
  call("ADD_MONTHS", (a) => `DATEADD(month, ${a[1]}, ${a[0]})`, "ADD_MONTHS()", "DATEADD(month, …)");
  call(
    "MONTHS_BETWEEN",
    (a) => {
      log.warn("MONTHS_BETWEEN returns fractions; DATEDIFF(month) counts month boundaries. Check results.");
      return `DATEDIFF(month, ${a[1]}, ${a[0]})`;
    },
    "MONTHS_BETWEEN()",
    "DATEDIFF(month, …)"
  );
  call(
    "TO_CHAR",
    (a) => {
      if (a.length === 1) return `CAST(${a[0]} AS NVARCHAR(4000))`;
      log.warn("TO_CHAR with a format mask → FORMAT(): Oracle and .NET format codes differ (e.g. 'YYYY-MM-DD' → 'yyyy-MM-dd').");
      return `FORMAT(${a[0]}, ${a[1]})`;
    },
    "TO_CHAR()",
    "CAST / FORMAT()"
  );
  call(
    "TO_DATE",
    (a) => {
      if (a.length > 1) log.warn("TO_DATE format mask dropped: make sure the string is in ISO format (yyyy-mm-dd).");
      return `CONVERT(DATETIME2, ${a[0]})`;
    },
    "TO_DATE()",
    "CONVERT(DATETIME2, …)"
  );
  call("TO_NUMBER", (a) => `CAST(${a[0]} AS DECIMAL(38,10))`, "TO_NUMBER()", "CAST(… AS DECIMAL)");
  call(
    "TRUNC",
    (a) => {
      if (a.length !== 1) return null;
      log.warn("TRUNC(x) was treated as a date. If x is a number, use FLOOR() instead.");
      return `CAST(${a[0]} AS DATE)`;
    },
    "TRUNC(date)",
    "CAST(… AS DATE)"
  );
  call(
    "EXTRACT",
    (a) => {
      const m = /^(YEAR|MONTH|DAY|HOUR|MINUTE|SECOND)\s+FROM\s+([\s\S]+)$/i.exec(a[0] || "");
      return m ? `DATEPART(${m[1].toLowerCase()}, ${m[2]})` : null;
    },
    "EXTRACT(part FROM x)",
    "DATEPART(part, x)"
  );
  call(
    "DECODE",
    (a) => {
      if (a.length < 3) return null;
      const [e, ...rest] = a;
      let out = `CASE ${e}`;
      for (let i = 0; i + 1 < rest.length; i += 2) out += ` WHEN ${rest[i]} THEN ${rest[i + 1]}`;
      if (rest.length % 2 === 1) out += ` ELSE ${rest[rest.length - 1]}`;
      return `${out} END`;
    },
    "DECODE()",
    "CASE … WHEN … END"
  );
  t = rule(t, log, /\bSYSTIMESTAMP\b/gi, "SYSDATETIME()", "SYSTIMESTAMP", "SYSDATETIME()");
  t = rule(t, log, /\bSYSDATE\b/gi, "GETDATE()", "SYSDATE", "GETDATE()");
  t = rule(t, log, /\bSQL%ROWCOUNT\b/gi, "@@ROWCOUNT", "SQL%ROWCOUNT", "@@ROWCOUNT");
  t = rule(t, log, /\bDBMS_OUTPUT\.PUT_LINE\s*\(([^;]*)\)\s*;/gi, "PRINT $1;", "DBMS_OUTPUT.PUT_LINE", "PRINT");
  t = rule(t, log, /\b(\w+)\.NEXTVAL\b/gi, "NEXT VALUE FOR $1", "seq.NEXTVAL", "NEXT VALUE FOR seq");

  if (/\|\|/.test(t)) {
    t = rule(t, log, /\s*\|\|\s*/g, " + ", "||", "+");
    log.warn("Oracle || ignores NULLs, SQL Server + returns NULL if any part is NULL. Wrap nullable parts in ISNULL(x, '') or use CONCAT().");
  }

  t = fetchToTop(t, log);

  // ---- data types
  t = rule(t, log, /\bNVARCHAR2\s*\(\s*(\d+)\s*(?:CHAR|BYTE)?\s*\)/gi, "NVARCHAR($1)", "NVARCHAR2", "NVARCHAR");
  t = rule(t, log, /\bVARCHAR2\s*\(\s*(\d+)\s*(?:CHAR|BYTE)?\s*\)/gi, "VARCHAR($1)", "VARCHAR2", "VARCHAR");
  t = rule(t, log, /\bNCLOB\b/gi, "NVARCHAR(MAX)", "NCLOB", "NVARCHAR(MAX)");
  t = rule(t, log, /\bCLOB\b/gi, "VARCHAR(MAX)", "CLOB", "VARCHAR(MAX)");
  t = rule(t, log, /\bBLOB\b/gi, "VARBINARY(MAX)", "BLOB", "VARBINARY(MAX)");
  t = rule(t, log, /\bRAW\s*\(\s*16\s*\)/gi, "UNIQUEIDENTIFIER", "RAW(16)", "UNIQUEIDENTIFIER");
  t = rule(t, log, /\bRAW\s*\(\s*(\d+)\s*\)/gi, "VARBINARY($1)", "RAW(n)", "VARBINARY(n)");
  t = rule(
    t,
    log,
    /\bNUMBER\s*\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)/gi,
    (_m, p, s) => numberType(Number(p), Number(s || 0)),
    "NUMBER(p,s)",
    "INT / BIGINT / DECIMAL / BIT"
  );
  t = rule(t, log, /\bNUMBER\s*\(\s*\*\s*,\s*0\s*\)/gi, "DECIMAL(38,0)", "NUMBER(*,0)", "DECIMAL(38,0)");
  if (/\bNUMBER\b/i.test(t)) {
    t = rule(t, log, /\bNUMBER\b/gi, "DECIMAL(38,10)", "NUMBER", "DECIMAL(38,10)");
    log.warn("Plain NUMBER has no precision: mapped to DECIMAL(38,10). Pick a tighter type if you know the range.");
  }
  t = rule(t, log, /\bPLS_INTEGER\b|\bBINARY_INTEGER\b/gi, "INT", "PLS_INTEGER", "INT");
  t = rule(t, log, /\bBOOLEAN\b/gi, "BIT", "BOOLEAN", "BIT");
  t = rule(
    t,
    log,
    /\bTIMESTAMP\s*(\(\s*\d\s*\))?\s+WITH\s+(LOCAL\s+)?TIME\s+ZONE\b/gi,
    "DATETIMEOFFSET",
    "TIMESTAMP WITH TIME ZONE",
    "DATETIMEOFFSET"
  );
  t = rule(t, log, /\bTIMESTAMP\b(\s*\(\s*\d\s*\))?/gi, "DATETIME2", "TIMESTAMP", "DATETIME2");
  t = rule(t, log, /\bBINARY_DOUBLE\b/gi, "FLOAT", "BINARY_DOUBLE", "FLOAT");
  t = rule(t, log, /\bBINARY_FLOAT\b/gi, "REAL", "BINARY_FLOAT", "REAL");
  t = rule(
    t,
    log,
    /\bGENERATED\s+(?:BY\s+DEFAULT(?:\s+ON\s+NULL)?|ALWAYS)\s+AS\s+IDENTITY(?:\s*\(([^)]*)\))?/gi,
    (_m, opts: string | undefined) => {
      const start = /START\s+WITH\s+(\d+)/i.exec(opts || "")?.[1] || "1";
      const inc = /INCREMENT\s+BY\s+(\d+)/i.exec(opts || "")?.[1] || "1";
      return `IDENTITY(${start},${inc})`;
    },
    "GENERATED AS IDENTITY",
    "IDENTITY(s,i)"
  );
  if (/(?<![\w_])DATE\b/i.test(t)) log.warn("Oracle DATE also stores the time. Consider DATETIME2(0) where time matters.");

  // ---- bind variables
  if (!procedural) t = rule(t, log, /(?<![:\w]):([A-Za-z_]\w*)/g, "@$1", ":param", "@param");

  if (/\bROWNUM\b/i.test(t)) log.warn("ROWNUM has no direct equivalent: use TOP or ROW_NUMBER() OVER (ORDER BY …).");
  if (/\bCONNECT\s+BY\b/i.test(t)) log.warn("CONNECT BY (hierarchical query) needs a recursive CTE in SQL Server.");
  if (/\(\+\)/.test(t)) log.warn("Old (+) outer-join syntax must be rewritten as LEFT/RIGHT JOIN.");
  return t;
}
