"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CodeView, SideBySideDiff } from "@/components/CodeDiff";
import { Button, Card, EnvPill, RiskBadge, Sparkle, StatusBadge, btn } from "@/components/ui";
import { downloadText } from "@/lib/excel";
import { setConverterInput, useCompareResult } from "@/lib/store";
import { TYPE_LABELS } from "@/lib/types";

function ObjectDetail() {
  const params = useSearchParams();
  const router = useRouter();
  const result = useCompareResult();
  const [copied, setCopied] = useState(false);
  const id = params.get("id") || "";
  const item = result?.items.find((i) => i.id === id);

  if (!result || !item)
    return (
      <div className="flex flex-col gap-4">
        <h1 className="m-0 text-2xl font-bold">Object not found</h1>
        <p className="m-0 text-muted">Run a comparison first, then open an object from the results list.</p>
        <div>
          <Link href="/results" className={btn.primary}>
            Back to results
          </Link>
        </div>
      </div>
    );

  const text = item.sourceDef ?? item.targetDef ?? "";
  const engine = item.sourceDef != null ? result.source.engine : result.target.engine;

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[13px] text-muted mb-1.5">
            <Link href="/results" className="text-brand no-underline hover:underline">
              Results
            </Link>{" "}
            › {TYPE_LABELS[item.type]}
          </div>
          <h1 className="m-0 text-2xl font-semibold font-mono break-all">{item.fullName}</h1>
          <div className="flex flex-wrap items-center gap-2.5 mt-2.5 text-[13px]">
            <StatusBadge status={item.status} />
            {item.status === "DIFF" && (
              <>
                <span className="text-green-800 font-semibold">+{item.added} lines</span>
                <span className="text-red-800 font-semibold">−{item.removed} lines</span>
              </>
            )}
            <span className="text-muted">
              {result.options.ignoreWhitespace ? "Whitespace and comments ignored when comparing" : "Exact text compared"}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Button
            onClick={async () => {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy definition"}
          </Button>
          <Button onClick={() => downloadText(text, `${item.fullName}.sql`)}>Download .sql</Button>
          {item.sourceDef && ["View", "StoredProcedure", "Function", "Trigger"].includes(item.type) && (
            <Button
              onClick={() => {
                setConverterInput({ sql: text, from: engine });
                router.push("/converter");
              }}
            >
              Convert to {engine === "sqlserver" ? "Oracle" : "SQL Server"}
            </Button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap gap-5 items-start">
        <Card className="flex-[999_1_640px] min-w-0 overflow-hidden">
          <div className="grid grid-cols-2 border-b border-line text-[13px] font-semibold">
            <div className="px-4 py-3 flex items-center gap-2 border-r border-line">
              <EnvPill tone="target">{result.target.label}</EnvPill>Target (current)
            </div>
            <div className="px-4 py-3 flex items-center gap-2">
              <EnvPill tone="source">{result.source.label}</EnvPill>Source (reference)
            </div>
          </div>
          {item.status === "DIFF" ? (
            <SideBySideDiff left={item.targetDef || ""} right={item.sourceDef || ""} ignoreWhitespace={result.options.ignoreWhitespace} />
          ) : (
            <div className="grid grid-cols-2">
              <div className="border-r border-line min-w-0">
                {item.targetDef != null ? <CodeView code={item.targetDef} /> : <div className="p-6 text-sm text-muted">Does not exist in {result.target.label}.</div>}
              </div>
              <div className="min-w-0">
                {item.sourceDef != null ? <CodeView code={item.sourceDef} /> : <div className="p-6 text-sm text-muted">Does not exist in {result.source.label}.</div>}
              </div>
            </div>
          )}
        </Card>

        <aside aria-label="Review" className="flex-[1_1_300px] min-w-0 flex flex-col gap-4">
          <Card className="p-5 flex flex-col gap-3.5">
            <div className="flex items-center gap-2">
              <Sparkle className="text-violet-800" />
              <h2 className="m-0 text-base font-semibold">{item.aiReviewed ? "AI review" : "Rule-based review"}</h2>
            </div>
            <div className="flex items-center gap-2.5">
              <RiskBadge risk={item.risk} />
              <span className="text-[13px] text-muted">Risk of making {result.target.label} match {result.source.label}</span>
            </div>
            <p className="m-0 text-sm leading-relaxed text-gray-700">{item.note}</p>
            {item.noise && (
              <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-[13px] text-violet-950">
                Flagged as noise: excluded from the deploy script unless you include noise objects.
              </div>
            )}
          </Card>
          <Card className="p-5 flex flex-col gap-2 text-sm">
            <h2 className="m-0 text-base font-semibold">Details</h2>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-muted">Type</dt>
              <dd className="m-0">{TYPE_LABELS[item.type]}</dd>
              <dt className="text-muted">Schema</dt>
              <dd className="m-0">{item.schema}</dd>
              {item.parent && (
                <>
                  <dt className="text-muted">Parent</dt>
                  <dd className="m-0 break-all">{item.parent}</dd>
                </>
              )}
              <dt className="text-muted">Status</dt>
              <dd className="m-0">
                {item.status === "MISSING"
                  ? `Only in ${result.source.label}`
                  : item.status === "EXTRA"
                    ? `Only in ${result.target.label}`
                    : "In both, definitions differ"}
              </dd>
            </dl>
          </Card>
        </aside>
      </div>
    </>
  );
}

export default function ObjectPage() {
  return (
    <Suspense fallback={<div className="text-muted">Loading…</div>}>
      <ObjectDetail />
    </Suspense>
  );
}
