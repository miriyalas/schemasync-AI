"use client";

import { useEffect, useState } from "react";
import { SqlEditor } from "@/components/CodeDiff";
import { Button, Card, ErrorBox, PageHeader, cx } from "@/components/ui";
import { downloadText } from "@/lib/excel";
import { fetchJson } from "@/lib/http";
import { takeConverterInput } from "@/lib/store";
import type { ConvertResult, Engine } from "@/lib/types";

const NAMES: Record<Engine, string> = { sqlserver: "SQL Server T-SQL", oracle: "Oracle PL/SQL" };

const SAMPLE = `CREATE PROCEDURE ropa.sp_GetTopRecords
    @MinLen INT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        SELECT TOP 10 r.RecordId,
               ISNULL(r.Name, 'N/A') + ' - ' + r.Code AS Label,
               GETDATE() AS RunAt
        FROM ropa.Records r
        WHERE LEN(r.Code) > @MinLen;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;`;

const CONF: Record<ConvertResult["confidence"], string> = {
  High: "bg-green-100 text-green-800",
  Medium: "bg-amber-100 text-amber-900",
  Low: "bg-red-50 text-red-800",
};

export default function ConverterPage() {
  const [from, setFrom] = useState<Engine>("sqlserver");
  const [input, setInput] = useState(SAMPLE);
  const [useAI, setUseAI] = useState(true);
  const [ai, setAi] = useState<{ enabled: boolean; provider: string; model: string } | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const to: Engine = from === "sqlserver" ? "oracle" : "sqlserver";

  useEffect(() => {
    const pending = takeConverterInput();
    if (pending) {
      setInput(pending.sql);
      setFrom(pending.from);
    }
    fetchJson<{ enabled: boolean; provider: string; model: string }>("/api/ai/status")
      .then((r) => setAi(r.data))
      .catch(() => setAi({ enabled: false, provider: "none", model: "" }));
  }, []);

  async function convert() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetchJson<ConvertResult & { error?: string }>("/api/convert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql: input, from, to, useAI: useAI && !!ai?.enabled }),
      });
      if (!r.ok) throw new Error(r.data.error || `Conversion failed (${r.status}).`);
      setResult(r.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function swap() {
    if (result) setInput(result.sql);
    setFrom(to);
    setResult(null);
  }

  return (
    <>
      <PageHeader
        crumb="Tools › SQL Converter"
        title="SQL Converter"
        subtitle="Rules convert what they can with certainty. AI finishes procedural code. Every change is listed."
        actions={
          <>
            <div className="flex items-center gap-2 p-1 bg-white border border-gray-300 rounded-[10px]">
              <span className="px-3 text-sm font-semibold">{NAMES[from]}</span>
              <button
                type="button"
                aria-label="Swap direction"
                onClick={swap}
                className="w-11 h-11 rounded-lg bg-indigo-50 text-brand flex items-center justify-center hover:bg-indigo-100"
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 8h14l-3-3M20 16H6l3 3" />
                </svg>
              </button>
              <span className="px-3 text-sm font-semibold">{NAMES[to]}</span>
            </div>
            <Button variant="primary" onClick={convert} disabled={busy || !input.trim()}>
              {busy ? "Converting…" : "Convert"}
            </Button>
          </>
        }
      />

      <label className="flex items-center gap-2.5 text-sm -mt-2">
        <input type="checkbox" className="w-[18px] h-[18px] accent-brand" checked={useAI && !!ai?.enabled} disabled={!ai?.enabled} onChange={(e) => setUseAI(e.target.checked)} />
        <span>
          Use AI for procedural code{" "}
          <span className="text-muted">
            {ai?.enabled ? `(${ai.provider} · ${ai.model})` : "(not configured: set AI_PROVIDER and an API key; rules still work)"}
          </span>
        </span>
      </label>

      {error && <ErrorBox>{error}</ErrorBox>}

      <section aria-label="Editors" className="grid gap-5 grid-cols-[repeat(auto-fit,minmax(380px,1fr))]">
        <Card className="overflow-hidden flex flex-col min-w-0">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-line">
            <span className="text-sm font-semibold">Input · {NAMES[from]}</span>
            <Button variant="small" onClick={() => setInput("")}>
              Clear
            </Button>
          </div>
          <SqlEditor label={`Input SQL (${NAMES[from]})`} value={input} onChange={setInput} />
        </Card>
        <Card className="overflow-hidden flex flex-col min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-line">
            <span className="text-sm font-semibold">Output · {NAMES[to]}</span>
            <span className="flex gap-2">
              <Button
                variant="small"
                disabled={!result}
                onClick={async () => {
                  if (!result) return;
                  await navigator.clipboard.writeText(result.sql);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button variant="small" disabled={!result} onClick={() => result && downloadText(result.sql, `converted_${to}.sql`)}>
                Download .sql
              </Button>
            </span>
          </div>
          {result ? (
            <SqlEditor label={`Converted SQL (${NAMES[to]})`} value={result.sql} readOnly />
          ) : (
            <div className="h-[440px] flex items-center justify-center text-sm text-muted p-6 text-center">Press Convert to see the {NAMES[to]} version here.</div>
          )}
        </Card>
      </section>

      {result && (
        <div className="flex flex-wrap gap-5 items-start">
          <Card className="flex-[999_1_560px] min-w-0 overflow-hidden">
            <h2 className="m-0 px-5 py-3.5 text-base font-semibold border-b border-line">What changed ({result.changes.length})</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[13.5px]">
                <thead>
                  <tr className="text-left text-muted text-xs uppercase tracking-wider">
                    <th scope="col" className="px-5 py-2.5 font-semibold">From</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">To</th>
                    <th scope="col" className="pl-3 pr-5 py-2.5 font-semibold">By</th>
                  </tr>
                </thead>
                <tbody>
                  {result.changes.map((c, i) => (
                    <tr key={i}>
                      <td className="px-5 py-2 border-t border-gray-100 font-mono text-[12.5px] whitespace-pre-wrap">{c.from}</td>
                      <td className="px-3 py-2 border-t border-gray-100 font-mono text-[12.5px] whitespace-pre-wrap">{c.to}</td>
                      <td className="pl-3 pr-5 py-2 border-t border-gray-100">
                        <span className={cx("inline-block text-xs font-bold px-2 py-0.5 rounded-md", c.by === "AI" ? "bg-violet-100 text-violet-800" : "bg-green-100 text-green-800")}>
                          {c.by}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {result.changes.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-5 py-6 text-muted">
                        No changes were needed.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <aside className="flex-[1_1_320px] min-w-0 flex flex-col gap-4">
            <Card className="p-5 flex flex-col gap-3">
              <h2 className="m-0 text-base font-semibold">Confidence</h2>
              <div className="flex items-center gap-2.5">
                <span className={cx("text-xs font-bold px-2 py-1 rounded-md uppercase", CONF[result.confidence])}>{result.confidence}</span>
                <span className="text-[13px] text-gray-700">
                  {result.usedAI ? "Rules + AI" : "Rules only"}
                  {result.procedural ? " · procedural code" : ""}
                </span>
              </div>
              {result.warnings.map((w) => (
                <div key={w} className="text-[13px] leading-relaxed text-amber-950 p-3 rounded-lg bg-amber-50 border border-amber-200">
                  {w}
                </div>
              ))}
            </Card>
            <Card className="p-5 flex flex-col gap-2.5">
              <h2 className="m-0 text-base font-semibold">Validation</h2>
              {result.validation.messages.map((m) => (
                <div key={m} className={cx("flex items-center gap-2 text-[13.5px]", result.validation.ok ? "text-green-800" : "text-red-800")}>
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    {result.validation.ok ? <path d="M5 12l5 5 9-10" /> : <path d="M6 6l12 12M18 6L6 18" />}
                  </svg>
                  {m}
                </div>
              ))}
              <p className="m-0 text-[13px] text-muted">Always test the output on {to === "oracle" ? "an Oracle" : "a SQL Server"} development database before using it.</p>
            </Card>
          </aside>
        </div>
      )}
    </>
  );
}
