import { diffLines } from "diff";
import { analyzeItem } from "./analyze";
import { displaySql, normalizeSql } from "./sqlScanner";
import {
  TYPE_GROUPS,
  TYPE_ORDER,
  type CompareOptions,
  type CompareResult,
  type DbObject,
  type DiffItem,
  type ObjectType,
  type Risk,
  type Snapshot,
} from "./types";

export function wantedTypes(opts: CompareOptions): Set<ObjectType> {
  const s = new Set<ObjectType>();
  for (const g of TYPE_GROUPS) if (opts.groups.includes(g.id)) g.types.forEach((t) => s.add(t));
  return s;
}

export function fullNameOf(o: Pick<DbObject, "schema" | "parent" | "name">): string {
  return [o.schema, o.parent, o.name].filter(Boolean).join(".");
}

/** Oracle schemas usually differ per environment (APP_DEV vs APP_SIT), so Oracle keys ignore the owner. */
function keyOf(o: DbObject, engine: Snapshot["engine"]): string {
  const name = engine === "oracle" ? [o.parent, o.name].filter(Boolean).join(".") : fullNameOf(o);
  return `${o.type}|${name.toLowerCase()}`;
}

function parentKey(o: DbObject, engine: Snapshot["engine"]): string | null {
  if (!o.parent) return null;
  const parentType: ObjectType | null =
    o.type === "Column" || o.type === "PrimaryKey" ? "Table" : o.type === "TableTypeColumn" ? "TableType" : null;
  if (!parentType) return null;
  const name = engine === "oracle" ? o.parent : `${o.schema}.${o.parent}`;
  return `${parentType}|${name.toLowerCase()}`;
}

function countLines(s: string | undefined): number {
  if (!s) return 0;
  return s.split("\n").length;
}

function lineDelta(target: string, source: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const part of diffLines(target, source, { ignoreWhitespace: false })) {
    if (part.added) added += part.count ?? countLines(part.value);
    else if (part.removed) removed += part.count ?? countLines(part.value);
  }
  return { added, removed };
}

export function compareSnapshots(source: Snapshot, target: Snapshot, options: CompareOptions): CompareResult {
  const wanted = wantedTypes(options);
  const norm = { ignoreWhitespace: options.ignoreWhitespace, ignoreCase: options.ignoreCase };

  const srcMap = new Map<string, DbObject>();
  const tgtMap = new Map<string, DbObject>();
  for (const o of source.objects) if (wanted.has(o.type)) srcMap.set(keyOf(o, source.engine), o);
  for (const o of target.objects) if (wanted.has(o.type)) tgtMap.set(keyOf(o, target.engine), o);

  const items: DiffItem[] = [];
  const childCounts = new Map<string, number>();

  const makeItem = (o: DbObject, status: DiffItem["status"], extra: Partial<DiffItem>): DiffItem => ({
    id: `${status}|${o.type}|${fullNameOf(o)}`,
    type: o.type,
    schema: o.schema,
    name: o.name,
    parent: o.parent,
    fullName: fullNameOf(o),
    status,
    added: 0,
    removed: 0,
    risk: "Low",
    noise: false,
    note: "",
    meta: o.meta,
    ...extra,
  });

  // MISSING: in source, not in target
  for (const [k, o] of srcMap) {
    if (tgtMap.has(k)) continue;
    const pk = parentKey(o, source.engine);
    if (pk && srcMap.has(pk) && !tgtMap.has(pk)) {
      childCounts.set(pk, (childCounts.get(pk) || 0) + (o.type === "PrimaryKey" ? 0 : 1));
      continue; // shown as part of the missing parent table / table type
    }
    const def = o.code ? displaySql(o.def) : o.def;
    items.push(makeItem(o, "MISSING", { sourceDef: def, added: countLines(def) }));
  }

  // EXTRA: in target, not in source
  for (const [k, o] of tgtMap) {
    if (srcMap.has(k)) continue;
    const pk = parentKey(o, target.engine);
    if (pk && tgtMap.has(pk) && !srcMap.has(pk)) continue;
    const def = o.code ? displaySql(o.def) : o.def;
    items.push(makeItem(o, "EXTRA", { targetDef: def, removed: countLines(def) }));
  }

  // DIFF: in both, definitions differ after normalisation
  for (const [k, s] of srcMap) {
    const t = tgtMap.get(k);
    if (!t) continue;
    const same = s.code
      ? normalizeSql(s.def, norm) === normalizeSql(t.def, norm)
      : options.ignoreCase
        ? s.def.toLowerCase().replace(/\s+/g, " ") === t.def.toLowerCase().replace(/\s+/g, " ")
        : s.def === t.def;
    if (same) continue;
    const sd = s.code ? displaySql(s.def) : s.def;
    const td = t.code ? displaySql(t.def) : t.def;
    items.push(makeItem(s, "DIFF", { sourceDef: sd, targetDef: td, ...lineDelta(td, sd) }));
  }

  // Rule-based risk, noise and notes
  for (const it of items) {
    const pk = it.type === "Table" || it.type === "TableType" ? `${it.type}|${(source.engine === "oracle" ? it.name : it.fullName).toLowerCase()}` : "";
    Object.assign(it, analyzeItem(it, childCounts.get(pk) || 0));
  }

  const order = new Map(TYPE_ORDER.map((t, i) => [t, i]));
  const statusOrder = { DIFF: 0, MISSING: 1, EXTRA: 2 } as const;
  items.sort(
    (a, b) =>
      (order.get(a.type) ?? 99) - (order.get(b.type) ?? 99) ||
      statusOrder[a.status] - statusOrder[b.status] ||
      a.fullName.localeCompare(b.fullName)
  );

  return {
    source: { label: source.label, engine: source.engine },
    target: { label: target.label, engine: target.engine },
    generatedAt: new Date().toISOString(),
    options,
    summary: summarize(items),
    items,
    warnings: [
      ...source.warnings.map((w) => `${source.label}: ${w}`),
      ...target.warnings.map((w) => `${target.label}: ${w}`),
      ...(source.engine !== target.engine
        ? ["Source and target use different engines: types and code will differ by design. Use the SQL Converter for code."]
        : []),
    ],
  };
}

export function summarize(items: DiffItem[]): CompareResult["summary"] {
  const byType: CompareResult["summary"]["byType"] = {};
  const byRisk: Record<Risk, number> = { High: 0, Medium: 0, Low: 0, Noise: 0 };
  let missing = 0;
  let extra = 0;
  let diff = 0;
  for (const it of items) {
    const b = (byType[it.type] ||= { missing: 0, extra: 0, diff: 0 });
    if (it.status === "MISSING") {
      missing++;
      b.missing++;
    } else if (it.status === "EXTRA") {
      extra++;
      b.extra++;
    } else {
      diff++;
      b.diff++;
    }
    byRisk[it.risk]++;
  }
  return { total: items.length, missing, extra, diff, noise: byRisk.Noise, byType, byRisk };
}
