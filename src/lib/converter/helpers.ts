import { scanSql, unquoteIdent } from "../sqlScanner";
import type { ConvertChange } from "../types";

/**
 * Strings and comments are swapped for placeholders before rules run,
 * so a rule can never change text inside 'quotes' or comments.
 */
export interface Protected {
  text: string;
  restore: (t: string) => string;
}

export const STR = "\u0001S";
export const END = "\u0001";

export function protect(sql: string, identMode: "strip" | "keep"): Protected {
  const saved: string[] = [];
  let text = "";
  for (const s of scanSql(sql.replace(/\r\n?/g, "\n"))) {
    if (s.kind === "string") {
      text += `${STR}${saved.length}${END}`;
      saved.push(s.text);
    } else if (s.kind === "comment") {
      text += `\u0001C${saved.length}${END}`;
      saved.push(s.text);
    } else if (s.kind === "ident") {
      const inner = unquoteIdent(s.text);
      text += identMode === "strip" && /^[A-Za-z_][\w$#]*$/.test(inner) ? inner : s.text;
    } else text += s.text;
  }
  return {
    text,
    restore: (t: string) => t.replace(/\u0001[SC](\d+)\u0001/g, (_, i) => saved[Number(i)]),
  };
}

/** Split a function call's arguments at top-level commas. */
export function splitArgs(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of inner) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      args.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim() || args.length) args.push(cur.trim());
  return args;
}

/**
 * Replace calls like NAME(a, b) using a callback that receives the arguments.
 * Return null from the callback to leave a call unchanged.
 */
export function replaceCalls(text: string, name: string, fn: (args: string[]) => string | null): { text: string; count: number } {
  const re = new RegExp(`\\b${name}\\s*\\(`, "gi");
  let out = "";
  let last = 0;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // skip qualified names like dbo.LEN(
    if (m.index > 0 && /[.\w@$#]/.test(text[m.index - 1])) continue;
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close < 0) break;
    const args = splitArgs(text.slice(open + 1, close)).map((a) => replaceCalls(a, name, fn).text);
    const replacement = fn(args);
    if (replacement == null) continue;
    out += text.slice(last, m.index) + replacement;
    last = close + 1;
    re.lastIndex = close + 1;
    count++;
  }
  return { text: out + text.slice(last), count };
}

/** Collects rule changes once per rule, so the "What changed" list stays readable. */
export class ChangeLog {
  changes: ConvertChange[] = [];
  warnings: string[] = [];
  private seen = new Set<string>();
  add(from: string, to: string, by: "Rule" | "AI" = "Rule") {
    const k = `${from}→${to}`;
    if (this.seen.has(k)) return;
    this.seen.add(k);
    this.changes.push({ from, to, by });
  }
  warn(w: string) {
    if (!this.warnings.includes(w)) this.warnings.push(w);
  }
}

/** Apply a regex rule and log it when it matched. */
export function rule(text: string, log: ChangeLog, re: RegExp, to: string | ((...m: string[]) => string), from: string, toLabel: string): string {
  let hit = false;
  const out = text.replace(re, (...m: string[]) => {
    hit = true;
    return typeof to === "string" ? to.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? "") : to(...m);
  });
  if (hit) log.add(from, toLabel);
  return out;
}

/** Basic structural checks on converted SQL. */
export function basicValidation(sql: string): { ok: boolean; messages: string[] } {
  const messages: string[] = [];
  let depth = 0;
  let unterminated = false;
  for (const s of scanSql(sql)) {
    if (s.kind === "string" && (s.text.length < 2 || !s.text.endsWith("'"))) unterminated = true;
    if (s.kind !== "code") continue;
    for (const ch of s.text) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
    }
  }
  if (depth !== 0) messages.push(`Unbalanced parentheses (${depth > 0 ? "missing )" : "extra )"}).`);
  if (unterminated) messages.push("Unterminated string literal.");
  if (!messages.length) messages.push("Brackets and quotes are balanced.");
  return { ok: depth === 0 && !unterminated, messages };
}
