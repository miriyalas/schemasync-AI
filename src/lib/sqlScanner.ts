/**
 * Minimal SQL lexer that splits text into code / string / comment / quoted-identifier
 * segments, so rules never touch text inside string literals or comments.
 * Works for both T-SQL and Oracle PL/SQL.
 */
export type SegmentKind = "code" | "string" | "comment" | "ident";

export interface Segment {
  kind: SegmentKind;
  text: string;
}

export function scanSql(sql: string): Segment[] {
  const out: Segment[] = [];
  let buf = "";
  const n = sql.length;
  let i = 0;
  const flush = () => {
    if (buf) out.push({ kind: "code", text: buf });
    buf = "";
  };

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    // -- line comment
    if (ch === "-" && next === "-") {
      flush();
      let j = sql.indexOf("\n", i);
      if (j < 0) j = n;
      out.push({ kind: "comment", text: sql.slice(i, j) });
      i = j;
      continue;
    }
    // /* block comment */
    if (ch === "/" && next === "*") {
      flush();
      let j = sql.indexOf("*/", i + 2);
      j = j < 0 ? n : j + 2;
      out.push({ kind: "comment", text: sql.slice(i, j) });
      i = j;
      continue;
    }
    // 'string' or N'string'
    const prev = i > 0 ? sql[i - 1] : "";
    if (ch === "'" || ((ch === "N" || ch === "n") && next === "'" && !/[\w$#@]/.test(prev))) {
      flush();
      const start = i;
      i += ch === "'" ? 1 : 2;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      out.push({ kind: "string", text: sql.slice(start, i) });
      continue;
    }
    // [identifier]
    if (ch === "[") {
      flush();
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "]") {
          if (sql[j + 1] === "]") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      j = Math.min(j + 1, n);
      out.push({ kind: "ident", text: sql.slice(i, j) });
      i = j;
      continue;
    }
    // "identifier"
    if (ch === '"') {
      flush();
      let j = sql.indexOf('"', i + 1);
      j = j < 0 ? n : j + 1;
      out.push({ kind: "ident", text: sql.slice(i, j) });
      i = j;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

/** Unwrap [x] or "x" → x. */
export function unquoteIdent(text: string): string {
  if (text.startsWith("[") && text.endsWith("]")) return text.slice(1, -1).replace(/\]\]/g, "]");
  if (text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1);
  return text;
}

export interface NormalizeOptions {
  ignoreWhitespace: boolean;
  ignoreCase: boolean;
}

/**
 * Normalise SQL so that formatting-only differences do not show up as DIFF.
 * - removes comments, collapses whitespace (ignoreWhitespace)
 * - lower-cases code and removes [brackets]/"quotes" around identifiers (ignoreCase)
 * - CREATE OR ALTER / CREATE OR REPLACE → CREATE, PROC → PROCEDURE, drops trailing ; and GO
 */
export function normalizeSql(sql: string, opts: NormalizeOptions): string {
  const segs = scanSql(sql.replace(/\r\n?/g, "\n").replace(/^[ \t]*GO[ \t]*;?[ \t]*$/gim, ""));
  let text = "";
  for (const s of segs) {
    if (s.kind === "comment") {
      if (!opts.ignoreWhitespace) text += s.text;
      else text += " ";
      continue;
    }
    if (s.kind === "string") {
      text += s.text;
      continue;
    }
    if (s.kind === "ident") {
      const inner = unquoteIdent(s.text);
      text += opts.ignoreCase ? inner.toLowerCase() : s.text;
      continue;
    }
    text += opts.ignoreCase ? s.text.toLowerCase() : s.text;
  }
  if (opts.ignoreWhitespace) {
    text = collapseOutsideStrings(text);
  }
  const ci = opts.ignoreCase ? "" : "i";
  text = text
    .replace(new RegExp("\\bcreate\\s+or\\s+(alter|replace)\\b", "g" + ci), opts.ignoreCase ? "create" : "CREATE")
    .replace(new RegExp("\\bproc\\b", "g" + ci), opts.ignoreCase ? "procedure" : "PROCEDURE")
    .replace(/[;\s]+$/g, "")
    .trim();
  return text;
}

function collapseOutsideStrings(text: string): string {
  const segs = scanSql(text);
  return segs
    .map((s) =>
      s.kind === "string"
        ? s.text
        : s.text
            .replace(/\s+/g, " ")
            .replace(/\s*([(),;=<>+*/])\s*/g, "$1")
    )
    .join("")
    .trim();
}

/** Text for side-by-side display: unify line endings and trim trailing spaces. */
export function displaySql(sql: string): string {
  return sql
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}
