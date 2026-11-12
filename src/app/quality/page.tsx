"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, ErrorBox, PageHeader, cx } from "@/components/ui";
import { fetchJson } from "@/lib/http";
import type { SelfCheck } from "@/lib/selfTest";

interface TestCase {
  suite: string;
  title: string;
  status: "passed" | "failed" | "skipped" | "pending" | "todo";
  ms: number;
  failure?: string;
}
interface Report {
  generatedAt: string;
  success: boolean;
  totals: { files: number; tests: number; passed: number; failed: number; skipped: number };
  coverage: { lines: number; statements: number; functions: number; branches: number } | null;
  files: { file: string; status: string; tests: TestCase[] }[];
}
interface SelfResult {
  checks: SelfCheck[];
  passed: number;
  failed: number;
  ranAt: string;
}

const AREA: Record<string, string> = {
  "sqlScanner": "SQL parsing & normalisation",
  "analyze": "Risk & noise rules",
  "compare": "Compare engine",
  "converter.helpers": "Converter building blocks",
  "converter.tsqlToOracle": "Converter: SQL Server → Oracle",
  "converter.oracleToTsql": "Converter: Oracle → SQL Server",
  "converter.ai": "Converter: AI step",
  "deployScript": "Deployment script",
  "ai": "AI providers",
  "aiReview": "AI review",
  "db.sqlserver": "SQL Server metadata reader",
  "db.oracle": "Oracle metadata reader",
  "db.index": "Connection checks & error messages",
  "db.lazy": "Driver loading",
  "api": "API endpoints",
  "middleware": "Password protection",
  "http": "Error handling in the browser",
  "selfTest": "Live self-check",
};
const areaOf = (file: string) => AREA[file.replace(/^tests\//, "").replace(/\.test\.ts$/, "")] || file;

function Tick({ ok }: { ok: boolean }) {
  return (
    <span aria-label={ok ? "passed" : "failed"} className={cx("inline-flex w-5 h-5 rounded-full items-center justify-center flex-none", ok ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800")}>
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        {ok ? <path d="M5 12l5 5 9-10" /> : <path d="M6 6l12 12M18 6L6 18" />}
      </svg>
    </span>
  );
}

export default function QualityPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [self, setSelf] = useState<SelfResult | null>(null);
  const [running, setRunning] = useState(false);
  const [selfError, setSelfError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [onlyFailed, setOnlyFailed] = useState(false);

  useEffect(() => {
    fetchJson<Report>("/quality.json", { cache: "no-store" })
      .then((r) => (r.ok ? setReport(r.data) : setReportError("No test report found.")))
      .catch(() => setReportError("No test report found in this deployment. It is created when the app is built with `npm run build` (or `npm run test:report`)."));
  }, []);

  async function runSelf() {
    setRunning(true);
    setSelfError(null);
    try {
      const r = await fetchJson<SelfResult & { error?: string }>("/api/self-test", { cache: "no-store" });
      if (!r.ok) throw new Error(r.data.error || `Self-check failed (${r.status}).`);
      setSelf(r.data);
    } catch (e) {
      setSelfError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const files = useMemo(() => {
    if (!report) return [];
    const needle = q.trim().toLowerCase();
    return report.files
      .map((f) => ({
        ...f,
        area: areaOf(f.file),
        tests: f.tests.filter(
          (t) => (!onlyFailed || t.status === "failed") && (!needle || `${t.suite} ${t.title} ${areaOf(f.file)}`.toLowerCase().includes(needle))
        ),
      }))
      .filter((f) => f.tests.length);
  }, [report, q, onlyFailed]);

  const cov = report?.coverage;
  return (
    <>
      <PageHeader
        crumb="About › Quality"
        title="Quality & tests"
        subtitle="Proof that the app works: every build runs the full unit-test suite (a failing test stops the deployment), and the live self-check tests this running server right now."
        actions={
          <Button variant="primary" onClick={runSelf} disabled={running}>
            {running ? "Running…" : "Run live self-check"}
          </Button>
        }
      />

      <section aria-label="Summary" className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(190px,1fr))]">
        <Card className="p-5">
          <div className="text-[13px] font-medium text-muted">Unit tests passed</div>
          <div className="text-[34px] font-bold mt-1.5 tabular-nums">{report ? `${report.totals.passed}/${report.totals.tests}` : "–"}</div>
          {report && <div className={cx("text-[13px] font-medium", report.totals.failed ? "text-red-800" : "text-green-800")}>{report.totals.failed ? `${report.totals.failed} failing` : "All passing"}</div>}
        </Card>
        <Card className="p-5">
          <div className="text-[13px] font-medium text-muted">Code covered by tests</div>
          <div className="text-[34px] font-bold mt-1.5 tabular-nums">{cov ? `${Math.round(cov.lines)}%` : "–"}</div>
          {cov && <div className="text-[13px] text-muted">lines · branches {Math.round(cov.branches)}% · functions {Math.round(cov.functions)}%</div>}
        </Card>
        <Card className="p-5">
          <div className="text-[13px] font-medium text-muted">Test files</div>
          <div className="text-[34px] font-bold mt-1.5 tabular-nums">{report?.totals.files ?? "–"}</div>
          {report && <div className="text-[13px] text-muted">run {new Date(report.generatedAt).toLocaleString()}</div>}
        </Card>
        <Card className="p-5">
          <div className="text-[13px] font-medium text-muted">Live self-check</div>
          <div className="text-[34px] font-bold mt-1.5 tabular-nums">{self ? `${self.passed}/${self.passed + self.failed}` : "–"}</div>
          <div className={cx("text-[13px] font-medium", !self ? "text-muted" : self.failed ? "text-red-800" : "text-green-800")}>
            {!self ? "Not run yet" : self.failed ? `${self.failed} failing` : "All passing on this server"}
          </div>
        </Card>
      </section>

      <Card className="p-5 text-sm leading-relaxed text-gray-700">
        <h2 className="m-0 mb-2 text-base font-semibold text-ink">How to verify it yourself</h2>
        <ol className="m-0 pl-5 flex flex-col gap-1">
          <li>
            Click <strong>Run live self-check</strong>: {`it runs the real compare engine, risk rules, converter and deploy-script generator on known inputs inside this server and compares each result with the expected answer.`}
          </li>
          <li>
            Download the code and run <code className="font-mono text-[13px] bg-gray-100 px-1 rounded">npm test</code>: the same unit tests listed below run on your machine (no database or API key needed).
          </li>
          <li>On GitHub, the Actions tab shows the test run and coverage report for every commit.</li>
        </ol>
      </Card>

      {selfError && <ErrorBox>{selfError}</ErrorBox>}
      {self && (
        <Card className="overflow-hidden">
          <h2 className="m-0 px-5 py-3.5 text-base font-semibold border-b border-line">
            Live self-check · {new Date(self.ranAt).toLocaleTimeString()}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-[13.5px]">
              <thead>
                <tr className="text-left text-muted text-xs uppercase tracking-wider">
                  <th scope="col" className="px-5 py-2.5 font-semibold">Check</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Area</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Expected</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Actual</th>
                  <th scope="col" className="pl-3 pr-5 py-2.5 font-semibold text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {self.checks.map((c) => (
                  <tr key={c.id} className={c.pass ? "" : "bg-red-50"}>
                    <td className="px-5 py-2.5 border-t border-gray-100">
                      <span className="flex items-center gap-2.5">
                        {c.info ? <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-600 text-[11px] font-bold flex items-center justify-center flex-none">i</span> : <Tick ok={c.pass} />}
                        {c.name}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 border-t border-gray-100 text-muted whitespace-nowrap">{c.area}</td>
                    <td className="px-3 py-2.5 border-t border-gray-100 font-mono text-[12px] break-words max-w-[320px]">{c.info ? "–" : c.expected}</td>
                    <td className={cx("px-3 py-2.5 border-t border-gray-100 font-mono text-[12px] break-words max-w-[320px]", !c.pass && "text-red-800")}>{c.actual}</td>
                    <td className="pl-3 pr-5 py-2.5 border-t border-gray-100 text-right text-muted tabular-nums">{c.ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {reportError && <ErrorBox>{reportError}</ErrorBox>}
      {report && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 px-5 py-3.5 border-b border-line">
            <h2 className="m-0 text-base font-semibold mr-auto">Unit tests ({report.totals.tests})</h2>
            <label className="flex items-center gap-2 min-h-11 px-3 border border-gray-300 rounded-lg min-w-[220px]">
              <span className="sr-only">Search tests</span>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tests…" className="border-0 outline-none text-sm flex-1 min-w-0 bg-transparent" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="w-4 h-4 accent-brand" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} />
              Only failing
            </label>
          </div>
          <div className="divide-y divide-gray-100">
            {files.map((f) => {
              const failed = f.tests.filter((t) => t.status === "failed").length;
              return (
                <details key={f.file} className="group">
                  <summary className="flex items-center gap-3 px-5 min-h-12 cursor-pointer list-none hover:bg-gray-50">
                    <Tick ok={failed === 0} />
                    <span className="font-medium text-sm">{f.area}</span>
                    <span className="font-mono text-[12px] text-muted">{f.file}</span>
                    <span className="ml-auto text-[13px] text-muted tabular-nums">
                      {f.tests.length - failed}/{f.tests.length} passed
                    </span>
                    <svg aria-hidden="true" className="transition-transform group-open:rotate-90 text-muted" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </summary>
                  <ul className="m-0 list-none px-5 pb-3 pl-[52px] flex flex-col gap-1.5">
                    {f.tests.map((t, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-[13px]">
                        <Tick ok={t.status !== "failed"} />
                        <span className="flex-1">
                          {t.suite && <span className="text-muted">{t.suite} › </span>}
                          {t.title}
                          {t.failure && <pre className="mt-1 mb-0 p-2 rounded bg-red-50 text-red-900 text-[12px] whitespace-pre-wrap">{t.failure}</pre>}
                        </span>
                        <span className="text-muted tabular-nums">{t.ms} ms</span>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
            {files.length === 0 && <div className="px-5 py-8 text-center text-muted text-sm">No tests match.</div>}
          </div>
        </Card>
      )}
    </>
  );
}
