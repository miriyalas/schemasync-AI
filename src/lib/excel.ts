"use client";

import { buildDeployScript } from "./deployScript";
import { TYPE_LABELS, type CompareResult, type DiffItem } from "./types";

/* Excel export runs in the browser, so large results never hit server size limits. */

const STATUS_FILL: Record<string, string> = { MISSING: "FFFDE8E8", EXTRA: "FFFEF3C7", DIFF: "FFDBEAFE" };
const RISK_FILL: Record<string, string> = { High: "FFFDE8E8", Medium: "FFFEF3C7", Low: "FFDCFCE7", Noise: "FFEDE9FE" };
const CELL_LIMIT = 32000; // Excel cell text limit is 32,767 characters

const clip = (s?: string) => (s && s.length > CELL_LIMIT ? s.slice(0, CELL_LIMIT) + "\n… (truncated)" : s || "");

export async function downloadExcel(result: CompareResult) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SchemaSync AI";
  wb.created = new Date();

  type WS = ReturnType<typeof wb.addWorksheet>;
  const header = (ws: WS) => {
    const row = ws.getRow(1);
    row.font = { bold: true, color: { argb: "FFFFFFFF" } };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } };
    row.alignment = { vertical: "middle" };
    row.height = 22;
    ws.views = [{ state: "frozen", ySplit: 1 }];
    if (ws.columnCount) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
  };
  const paint = (ws: WS, statusCol?: number, riskCol?: number) => {
    ws.eachRow((row, i) => {
      if (i === 1) return;
      row.alignment = { vertical: "top", wrapText: true };
      if (statusCol) {
        const c = row.getCell(statusCol);
        const f = STATUS_FILL[String(c.value)];
        if (f) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: f } };
      }
      if (riskCol) {
        const c = row.getCell(riskCol);
        const f = RISK_FILL[String(c.value)];
        if (f) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: f } };
      }
    });
  };

  // ---- Summary
  const s = wb.addWorksheet("Summary");
  s.columns = [{ width: 28 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
  s.addRow(["SchemaSync AI – Schema comparison report"]).font = { bold: true, size: 16 };
  s.addRow([]);
  s.addRow(["Source (reference)", result.source.label, result.source.engine]);
  s.addRow(["Target", result.target.label, result.target.engine]);
  s.addRow(["Generated", new Date(result.generatedAt).toLocaleString()]);
  s.addRow(["Ignore whitespace / case", `${result.options.ignoreWhitespace ? "Yes" : "No"} / ${result.options.ignoreCase ? "Yes" : "No"}`]);
  s.addRow([]);
  const tot = s.addRow(["Total differences", result.summary.total]);
  tot.font = { bold: true };
  s.addRow(["Missing in target", result.summary.missing]);
  s.addRow(["Extra in target", result.summary.extra]);
  s.addRow(["Definition diff", result.summary.diff]);
  s.addRow(["Flagged as noise", result.summary.noise]);
  s.addRow([]);
  const rh = s.addRow(["Risk", "Count"]);
  rh.font = { bold: true };
  for (const r of ["High", "Medium", "Low", "Noise"] as const) {
    const row = s.addRow([r, result.summary.byRisk[r]]);
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: RISK_FILL[r] } };
  }
  s.addRow([]);
  const th = s.addRow(["Object type", "Missing", "Extra", "Diff", "Total"]);
  th.font = { bold: true };
  for (const [type, c] of Object.entries(result.summary.byType))
    s.addRow([TYPE_LABELS[type as keyof typeof TYPE_LABELS] || type, c.missing, c.extra, c.diff, c.missing + c.extra + c.diff]);
  if (result.warnings.length) {
    s.addRow([]);
    s.addRow(["Warnings"]).font = { bold: true };
    result.warnings.forEach((w) => s.addRow([w]));
  }

  // ---- item sheets
  const list = (name: string, items: DiffItem[]) => {
    const ws = wb.addWorksheet(name);
    ws.columns = [
      { header: "Object type", width: 18 },
      { header: "Schema", width: 12 },
      { header: "Object", width: 50 },
      { header: "Status", width: 11 },
      { header: "Lines +", width: 9 },
      { header: "Lines −", width: 9 },
      { header: "Risk", width: 10 },
      { header: "Noise", width: 8 },
      { header: "AI reviewed", width: 11 },
      { header: "Note", width: 70 },
    ];
    for (const i of items)
      ws.addRow([TYPE_LABELS[i.type], i.schema, i.fullName, i.status, i.added, i.removed, i.risk, i.noise ? "Yes" : "", i.aiReviewed ? "Yes" : "", i.note]);
    header(ws);
    paint(ws, 4, 7);
  };
  list("All Differences", result.items);
  list("Missing in Target", result.items.filter((i) => i.status === "MISSING"));
  list("Extra in Target", result.items.filter((i) => i.status === "EXTRA"));
  list("Definition Diff", result.items.filter((i) => i.status === "DIFF"));

  const defs = (name: string, items: DiffItem[], widths: [number, number]) => {
    const ws = wb.addWorksheet(name);
    ws.columns = [
      { header: "Object type", width: 18 },
      { header: "Object", width: 48 },
      { header: "Status", width: 11 },
      { header: "Risk", width: 10 },
      { header: `Source: ${result.source.label}`, width: widths[0] },
      { header: `Target: ${result.target.label}`, width: widths[1] },
      { header: "Note", width: 50 },
    ];
    for (const i of items) ws.addRow([TYPE_LABELS[i.type], i.fullName, i.status, i.risk, clip(i.sourceDef), clip(i.targetDef), i.note]);
    header(ws);
    paint(ws, 3, 4);
  };
  defs("Columns", result.items.filter((i) => i.type === "Column" || i.type === "TableTypeColumn"), [40, 40]);
  defs(
    "Keys & Indexes",
    result.items.filter((i) => ["PrimaryKey", "UniqueConstraint", "ForeignKey", "CheckConstraint", "Index"].includes(i.type)),
    [50, 50]
  );
  defs(
    "Code Objects",
    result.items.filter((i) => ["View", "StoredProcedure", "Function", "Trigger", "Package", "PackageBody", "TableType"].includes(i.type)),
    [80, 80]
  );

  // ---- deployment script
  const ds = wb.addWorksheet("Deploy Script");
  ds.columns = [{ header: `Deployment script for ${result.target.label} (review before running)`, width: 140 }];
  for (const l of buildDeployScript(result).split("\n")) ds.addRow([l]);
  header(ds);
  ds.getColumn(1).font = { name: "Consolas", size: 10 };

  const buf = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/(\d{8})(\d{4})/, "$1_$2");
  const safe = (x: string) => x.replace(/[^\w-]+/g, "_");
  triggerDownload(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `schema_compare_${safe(result.source.label)}_vs_${safe(result.target.label)}_${stamp}.xlsx`
  );
}

export function downloadText(text: string, filename: string) {
  triggerDownload(new Blob([text], { type: "text/plain;charset=utf-8" }), filename);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
