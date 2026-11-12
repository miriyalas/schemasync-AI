"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, Card, EnvPill, PageHeader, RiskBadge, Sparkle, StatusBadge, btn, cx } from "@/components/ui";
import { buildDeployScript } from "@/lib/deployScript";
import { downloadExcel, downloadText } from "@/lib/excel";
import { useCompareResult } from "@/lib/store";
import { TYPE_LABELS, type DiffItem, type Risk } from "@/lib/types";

type Filter = "all" | "MISSING" | "EXTRA" | "DIFF" | "noise";
const PAGE = 200;

export default function ResultsPage() {
  const result = useCompareResult();
  const [filter, setFilter] = useState<Filter>("all");
  const [type, setType] = useState("all");
  const [risk, setRisk] = useState<"all" | Risk>("all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [exporting, setExporting] = useState(false);
  const [includeNoise, setIncludeNoise] = useState(false);

  const rows = useMemo(() => {
    if (!result) return [];
    const needle = q.trim().toLowerCase();
    return result.items.filter(
      (i) =>
        (filter === "all" || (filter === "noise" ? i.noise : i.status === filter)) &&
        (type === "all" || i.type === type) &&
        (risk === "all" || i.risk === risk) &&
        (!needle || i.fullName.toLowerCase().includes(needle) || i.note.toLowerCase().includes(needle))
    );
  }, [result, filter, type, risk, q]);

  if (!result)
    return (
      <>
        <PageHeader crumb="Results" title="No comparison yet" subtitle="Run a comparison first, or try the built-in demo data." />
        <div>
          <Link href="/" className={btn.primary}>
            New comparison
          </Link>
        </div>
      </>
    );

  const s = result.summary;
  const aiCount = result.items.filter((i) => i.aiReviewed).length;
  const highItems = result.items.filter((i) => i.risk === "High");

  const chips: { id: Filter; label: string }[] = [
    { id: "all", label: `All ${s.total}` },
    { id: "MISSING", label: `Missing ${s.missing}` },
    { id: "EXTRA", label: `Extra ${s.extra}` },
    { id: "DIFF", label: `Diff ${s.diff}` },
    { id: "noise", label: `Noise ${s.noise}` },
  ];

  return (
    <>
      <PageHeader
        crumb={`Results › ${new Date(result.generatedAt).toLocaleString()}`}
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            <EnvPill tone="source">{result.source.label}</EnvPill>vs<EnvPill tone="target">{result.target.label}</EnvPill>
          </span>
        }
        subtitle={`${result.source.label} is the reference. "Missing" means the object exists in ${result.source.label} but not in ${result.target.label}.`}
        actions={
          <>
            <Link href="/" className={btn.secondary}>
              New comparison
            </Link>
            <Button
              onClick={() =>
                downloadText(buildDeployScript(result, { includeNoise }), `deploy_${result.target.label.replace(/\W+/g, "_")}_${result.generatedAt.slice(0, 10)}.sql`)
              }
            >
              Deploy script (.sql)
            </Button>
            <Button
              variant="primary"
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  await downloadExcel(result);
                } finally {
                  setExporting(false);
                }
              }}
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
              </svg>
              {exporting ? "Building Excel…" : "Download Excel"}
            </Button>
          </>
        }
      />

      <section aria-label="Summary" className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(190px,1fr))]">
        {[
          { label: "Total differences", value: s.total, dot: "" },
          { label: `Missing in ${result.target.label}`, value: s.missing, dot: "bg-red-600" },
          { label: `Extra in ${result.target.label}`, value: s.extra, dot: "bg-amber-600" },
          { label: "Definition diff", value: s.diff, dot: "bg-blue-600" },
          { label: "High risk", value: s.byRisk.High, dot: "bg-red-800" },
        ].map((t) => (
          <Card key={t.label} className="p-5">
            <div className="flex items-center gap-2 text-[13px] font-medium text-muted">
              {t.dot && <span className={cx("w-2.5 h-2.5 rounded-[3px]", t.dot)} />}
              {t.label}
            </div>
            <div className="text-[34px] font-bold mt-1.5 tabular-nums">{t.value}</div>
          </Card>
        ))}
      </section>

      <section aria-label="Summary notes" className="rounded-xl border border-violet-200 bg-violet-50 px-5 py-4 flex gap-3.5 items-start text-violet-950">
        <Sparkle className="flex-none mt-0.5 text-violet-800" />
        <div className="text-sm leading-relaxed">
          <strong>Summary.</strong> {s.noise} object{s.noise === 1 ? " looks" : "s look"} like backup, temp or test copies and can usually be skipped.{" "}
          {highItems.length > 0 ? (
            <>
              Review the {highItems.length} high-risk item{highItems.length === 1 ? "" : "s"} first
              {highItems[0] ? (
                <>
                  , starting with <span className="font-mono text-[13px]">{highItems[0].fullName}</span> ({highItems[0].note.replace(/\.$/, "")})
                </>
              ) : null}
              .
            </>
          ) : (
            "No high-risk changes found."
          )}{" "}
          {aiCount > 0 ? `${aiCount} differences were reviewed by AI.` : "Notes come from rule-based checks (AI review is off or not configured)."}
        </div>
      </section>

      {result.warnings.length > 0 && (
        <details className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <summary className="cursor-pointer font-medium">{result.warnings.length} warning(s)</summary>
          <ul className="mt-2 mb-0 pl-5">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      <Card className="flex flex-col min-w-0">
        <div className="flex flex-wrap items-center gap-2.5 px-5 py-4 border-b border-line">
          <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={filter === c.id}
                onClick={() => {
                  setFilter(c.id);
                  setLimit(PAGE);
                }}
                className={cx(
                  "min-h-11 px-3.5 rounded-full text-sm font-medium border",
                  filter === c.id ? "bg-brand border-brand text-white" : "bg-white border-gray-300 text-ink hover:bg-gray-50"
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
          <label className="ml-auto flex items-center gap-2 min-h-11 px-3 border border-gray-300 rounded-lg min-w-[220px]">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5B6370" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="6" />
              <path d="M20 20l-4.5-4.5" />
            </svg>
            <span className="sr-only">Search objects</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search objects or notes…" className="border-0 outline-none text-sm flex-1 min-w-0 bg-transparent" />
          </label>
          <label className="flex items-center gap-2 text-[13px] text-gray-700">
            Type
            <select value={type} onChange={(e) => setType(e.target.value)} className="min-h-11 px-3 border border-gray-300 rounded-lg text-sm bg-white">
              <option value="all">All types</option>
              {Object.entries(s.byType).map(([t, c]) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t as keyof typeof TYPE_LABELS]} ({c.missing + c.extra + c.diff})
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[13px] text-gray-700">
            Risk
            <select value={risk} onChange={(e) => setRisk(e.target.value as Risk | "all")} className="min-h-11 px-3 border border-gray-300 rounded-lg text-sm bg-white">
              <option value="all">All</option>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
              <option>Noise</option>
            </select>
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-muted text-xs uppercase tracking-wider">
                <th scope="col" className="px-5 py-3 font-semibold border-b border-line">Object</th>
                <th scope="col" className="px-3 py-3 font-semibold border-b border-line">Type</th>
                <th scope="col" className="px-3 py-3 font-semibold border-b border-line">Status</th>
                <th scope="col" className="px-3 py-3 font-semibold border-b border-line">Risk</th>
                <th scope="col" className="pl-3 pr-5 py-3 font-semibold border-b border-line">Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((i: DiffItem) => (
                <tr key={i.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3.5 border-b border-gray-100 max-w-[460px]">
                    <Link href={`/results/object?id=${encodeURIComponent(i.id)}`} className="font-mono text-[13px] text-brand no-underline hover:underline break-all">
                      {i.fullName}
                    </Link>
                  </td>
                  <td className="px-3 py-3.5 border-b border-gray-100 text-gray-700 whitespace-nowrap">{TYPE_LABELS[i.type]}</td>
                  <td className="px-3 py-3.5 border-b border-gray-100 whitespace-nowrap">
                    <StatusBadge status={i.status} />
                    {i.status === "DIFF" && (
                      <span className="ml-2 text-xs text-muted">
                        +{i.added} / −{i.removed}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3.5 border-b border-gray-100 whitespace-nowrap">
                    <RiskBadge risk={i.risk} />
                  </td>
                  <td className="pl-3 pr-5 py-3.5 border-b border-gray-100 text-gray-700">
                    {i.aiReviewed && <Sparkle className="inline w-3.5 h-3.5 mr-1 -mt-0.5 text-violet-700" />}
                    {i.note}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-muted">
                    {result.items.length === 0 ? "No differences: the two schemas match for the selected object types." : "Nothing matches these filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-[13px] text-muted">
          <span>
            Showing {Math.min(limit, rows.length)} of {rows.length}
            {rows.length > limit && (
              <button type="button" className="ml-3 text-brand font-medium" onClick={() => setLimit((l) => l + PAGE)}>
                Show more
              </button>
            )}
          </span>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="w-4 h-4 accent-brand" checked={includeNoise} onChange={(e) => setIncludeNoise(e.target.checked)} />
            Include noise objects in the deploy script
          </label>
        </div>
      </Card>
    </>
  );
}
