"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConnectionForm } from "@/components/ConnectionForm";
import { Button, Card, ErrorBox, PageHeader } from "@/components/ui";
import { toReviewInputClient, mergeReviews } from "@/lib/reviewClient";
import { loadProfiles, saveProfile, type Profile } from "@/lib/profiles";
import { setResult } from "@/lib/store";
import { TYPE_GROUPS, type CompareResult, type ConnectionInput } from "@/lib/types";

const DEFAULT_GROUPS = ["tables", "keys", "foreignKeys", "checks", "indexes", "views", "procedures", "functions", "triggers", "tableTypes"];

const empty = (label: string): ConnectionInput => ({ engine: "sqlserver", label, host: "", database: "", user: "", password: "" });

export default function NewComparison() {
  const router = useRouter();
  const [source, setSource] = useState<ConnectionInput>(empty("DEV"));
  const [target, setTarget] = useState<ConnectionInput>(empty("SIT"));
  const [groups, setGroups] = useState<string[]>(DEFAULT_GROUPS);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(true);
  const [ignoreCase, setIgnoreCase] = useState(true);
  const [useAI, setUseAI] = useState(true);
  const [ai, setAi] = useState<{ enabled: boolean; provider: string; model: string } | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProfiles(loadProfiles());
    fetch("/api/ai/status")
      .then((r) => r.json())
      .then(setAi)
      .catch(() => setAi({ enabled: false, provider: "none", model: "" }));
  }, []);

  const toggleGroup = (id: string) => setGroups((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]));

  async function run(demo: boolean) {
    setError(null);
    setBusy(demo ? "Loading demo data…" : "Reading both databases…");
    try {
      const r = await fetch("/api/compare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ demo, source, target, options: { groups, ignoreWhitespace, ignoreCase } }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `Comparison failed (${r.status}).`);
      let result = data as CompareResult;

      if (useAI && ai?.enabled && result.items.length) {
        // Review the most important items first, in small batches.
        const rank = (i: CompareResult["items"][number]) => (i.status === "DIFF" ? 0 : i.noise ? 2 : 1);
        const queue = [...result.items].sort((a, b) => rank(a) - rank(b)).slice(0, 150);
        const batches: (typeof queue)[] = [];
        for (let i = 0; i < queue.length; i += 20) batches.push(queue.slice(i, i + 20));
        let done = 0;
        for (const batch of batches) {
          setBusy(`AI is reviewing differences… ${done}/${queue.length}`);
          try {
            const rr = await fetch("/api/ai/review", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ items: batch.map(toReviewInputClient) }),
            });
            const reviewed = await rr.json();
            if (rr.ok) result = mergeReviews(result, reviewed.items || []);
            else result.warnings = [...result.warnings, `AI review: ${reviewed.error || rr.status}`];
          } catch (e) {
            result.warnings = [...result.warnings, `AI review: ${(e as Error).message}`];
          }
          done += batch.length;
        }
        if (result.items.length > queue.length)
          result.warnings = [...result.warnings, `AI reviewed the first ${queue.length} of ${result.items.length} differences; the rest use rule-based notes.`];
      }

      setResult(result);
      router.push("/results");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const ready = source.host && target.host && source.user && target.user && groups.length > 0;

  return (
    <>
      <PageHeader
        crumb="Compare › New"
        title="New comparison"
        subtitle="Pick a source (reference) and a target. SchemaSync reads metadata only, with a read-only login."
        actions={
          <Button onClick={() => run(true)} disabled={!!busy}>
            Try with demo data
          </Button>
        }
      />

      <section aria-label="Connections" className="grid gap-5 grid-cols-[repeat(auto-fit,minmax(340px,1fr))]">
        <ConnectionForm title="Source (reference)" tone="source" value={source} onChange={setSource} profiles={profiles} onSaveProfile={(c) => setProfiles(saveProfile(c))} />
        <ConnectionForm title="Target" tone="target" value={target} onChange={setTarget} profiles={profiles} onSaveProfile={(c) => setProfiles(saveProfile(c))} />
      </section>

      <Card className="p-6 flex flex-col gap-4">
        <div>
          <h2 className="m-0 text-[17px] font-semibold">What to compare</h2>
          <p className="mt-1 mb-0 text-sm text-muted">Object types read from the system catalog views.</p>
        </div>
        <div className="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
          {TYPE_GROUPS.map((g) => (
            <label key={g.id} className="flex items-center gap-2.5 min-h-11 px-3 border border-line rounded-lg text-sm cursor-pointer bg-white">
              <input type="checkbox" className="w-[18px] h-[18px] accent-brand" checked={groups.includes(g.id)} onChange={() => toggleGroup(g.id)} />
              {g.label}
            </label>
          ))}
        </div>
      </Card>

      <Card className="p-6 flex flex-col gap-4">
        <div>
          <h2 className="m-0 text-[17px] font-semibold">Options</h2>
          <p className="mt-1 mb-0 text-sm text-muted">Normalising SQL first stops whitespace and comment changes showing up as DIFF.</p>
        </div>
        <div className="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
          {[
            { on: ignoreWhitespace, set: setIgnoreWhitespace, label: "Ignore whitespace and comments", hint: "Compare normalised SQL, not raw text", disabled: false },
            { on: ignoreCase, set: setIgnoreCase, label: "Ignore case and [brackets]", hint: "ropa.[Table] equals ROPA.Table", disabled: false },
            {
              on: useAI && !!ai?.enabled,
              set: setUseAI,
              label: "AI review: noise, risk and notes",
              hint: ai?.enabled ? `Using ${ai.provider} · ${ai.model}` : "Not configured: set AI_PROVIDER and an API key. Rule-based checks still run.",
              disabled: !ai?.enabled,
            },
          ].map((o) => (
            <label key={o.label} className="flex items-start gap-2.5 p-3 border border-line rounded-lg cursor-pointer bg-white">
              <input type="checkbox" className="w-[18px] h-[18px] mt-0.5 accent-brand flex-none" checked={o.on} disabled={o.disabled} onChange={(e) => o.set(e.target.checked)} />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{o.label}</span>
                <span className="text-[13px] text-muted">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-[13px] text-muted mr-auto">Only schema metadata and object definitions are sent to the AI, never table data.</span>
        {busy && (
          <span role="status" className="text-sm text-brand font-medium">
            {busy}
          </span>
        )}
        <Button variant="primary" onClick={() => run(false)} disabled={!ready || !!busy}>
          Run comparison
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </Button>
      </div>
    </>
  );
}
