import type { Metadata } from "next";
import pkg from "../../../package.json";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Tech stack · SchemaSync AI" };

const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
const v = (name: string) => (deps[name] || "").replace(/^[\^~]/, "");

const LAYERS: { layer: string; items: { name: string; version?: string; why: string }[] }[] = [
  {
    layer: "Frontend",
    items: [
      { name: "Next.js (App Router)", version: v("next"), why: "Pages and API in one app; deploys to Vercel or one Docker container" },
      { name: "React", version: v("react"), why: "UI components" },
      { name: "TypeScript", version: v("typescript"), why: "Type safety across browser and server code" },
      { name: "Tailwind CSS", version: v("tailwindcss"), why: "Styling without a component library or CDN" },
    ],
  },
  {
    layer: "Server / API",
    items: [
      { name: "Next.js Route Handlers (Node.js runtime)", why: "/api/compare, /api/convert, /api/test-connection, /api/ai/*, /api/self-test" },
      { name: "Middleware", why: "Optional username/password protection for the whole app" },
    ],
  },
  {
    layer: "Database access (read-only)",
    items: [
      { name: "mssql (tedious)", version: v("mssql"), why: "SQL Server: reads sys.* catalog views; pure JavaScript" },
      { name: "oracledb (Thin mode)", version: v("oracledb"), why: "Oracle: reads DBA_* / ALL_* views; no Instant Client needed" },
    ],
  },
  {
    layer: "Engine",
    items: [
      { name: "SQL lexer & normaliser", why: "Ignores whitespace, comments, case and brackets before comparing" },
      { name: "Compare engine", why: "MISSING / EXTRA / DIFF across 17 object types" },
      { name: "Rule-based risk & noise", why: "Flags backups, temp/test objects, breaking changes; works without AI" },
      { name: "diff (jsdiff)", version: v("diff"), why: "Line-by-line differences and side-by-side view" },
      { name: "SQL Converter", why: "~70 SQL Server ⇄ Oracle rules, AI for procedural code" },
      { name: "Deploy script generator", why: "Dependency-ordered SQL; never drops objects automatically" },
    ],
  },
  {
    layer: "AI (optional)",
    items: [
      { name: "Anthropic Claude · OpenAI · Azure OpenAI · Ollama", why: "Chosen with AI_PROVIDER; plain fetch, no SDK lock-in" },
    ],
  },
  {
    layer: "Exports",
    items: [{ name: "ExcelJS", version: v("exceljs"), why: "9-sheet Excel report built in the browser" }],
  },
  {
    layer: "Quality",
    items: [
      { name: "Vitest", version: v("vitest"), why: "Unit tests for every module; drivers and AI mocked" },
      { name: "@vitest/coverage-v8", version: v("@vitest/coverage-v8"), why: "Coverage report on every build" },
      { name: "Live self-check", why: "Tests the running server from the Quality page" },
    ],
  },
  {
    layer: "DevOps",
    items: [
      { name: "GitHub + GitHub Actions", why: "Typecheck → tests + coverage → build on every push and pull request" },
      { name: "Vercel", why: "Hosting with automatic deploys and preview URLs" },
      { name: "Docker / docker compose", why: "Self-hosting inside a company network" },
    ],
  },
];

const AI_CONCEPTS = [
  ["Hybrid rules + LLM", "Code finds the facts (what is missing or different); AI only explains, classifies and finishes procedural conversions."],
  ["Structured JSON output", "The model answers in a fixed JSON shape, so results go straight into the table and Excel."],
  ["Classification", "Each difference gets a risk level and a noise flag."],
  ["Prompting with hints", "The rule-based risk and draft conversion are given to the model as a starting point."],
  ["Context minimisation", "Only changed lines are sent, never table data."],
  ["Graceful fallback", "If the AI fails, the rule-based result is shown with a warning."],
];

const FLOW = ["Browser", "Next.js API", "SQL Server / Oracle catalog", "Compare + rules", "AI review (optional)", "Excel · Deploy script"];

export default function TechStackPage() {
  return (
    <>
      <PageHeader crumb="About › Tech stack" title="Tech stack" subtitle="What SchemaSync AI is built with, and why each piece was chosen." />

      <section aria-label="Highlights" className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(190px,1fr))]">
        {[
          ["Single app", "Next.js UI + API"],
          ["Databases", "SQL Server · Oracle"],
          ["AI", "4 providers, optional"],
          ["Hosting", "Vercel · Docker"],
        ].map(([k, val]) => (
          <Card key={k} className="p-5">
            <div className="text-[13px] font-medium text-muted">{k}</div>
            <div className="text-lg font-semibold mt-1.5">{val}</div>
          </Card>
        ))}
      </section>

      <Card className="p-5">
        <h2 className="m-0 mb-4 text-base font-semibold">How a comparison flows</h2>
        <ol aria-label="Request flow" className="m-0 p-0 list-none flex flex-wrap items-center gap-2">
          {FLOW.map((step, i) => (
            <li key={step} className="flex items-center gap-2">
              <span className="px-3.5 py-2 rounded-lg border border-line bg-gray-50 text-sm font-medium">{step}</span>
              {i < FLOW.length - 1 && (
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5B6370" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              )}
            </li>
          ))}
        </ol>
      </Card>

      <Card className="overflow-hidden">
        <h2 className="m-0 px-5 py-3.5 text-base font-semibold border-b border-line">Components</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-muted text-xs uppercase tracking-wider">
                <th scope="col" className="px-5 py-2.5 font-semibold w-[190px]">Layer</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Technology</th>
                <th scope="col" className="px-3 py-2.5 font-semibold w-[100px]">Version</th>
                <th scope="col" className="pl-3 pr-5 py-2.5 font-semibold">Why</th>
              </tr>
            </thead>
            <tbody>
              {LAYERS.flatMap((l) =>
                l.items.map((it, i) => (
                  <tr key={l.layer + it.name}>
                    {i === 0 && (
                      <th scope="row" rowSpan={l.items.length} className="px-5 py-2.5 border-t border-line text-left align-top font-semibold">
                        {l.layer}
                      </th>
                    )}
                    <td className="px-3 py-2.5 border-t border-gray-100 font-medium">{it.name}</td>
                    <td className="px-3 py-2.5 border-t border-gray-100 font-mono text-[12.5px] text-muted">{it.version || "–"}</td>
                    <td className="pl-3 pr-5 py-2.5 border-t border-gray-100 text-gray-700">{it.why}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="m-0 mb-3 text-base font-semibold">AI concepts used</h2>
        <dl className="m-0 grid gap-x-6 gap-y-3 grid-cols-[repeat(auto-fit,minmax(300px,1fr))]">
          {AI_CONCEPTS.map(([k, d]) => (
            <div key={k}>
              <dt className="font-semibold text-sm">{k}</dt>
              <dd className="m-0 text-sm text-gray-700">{d}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="p-5 text-sm text-gray-700 leading-relaxed">
        <h2 className="m-0 mb-2 text-base font-semibold text-ink">Security by design</h2>
        Read-only catalog queries only, never table data · passwords used per request and never stored · AI receives SQL definitions only, never data ·
        optional app password · works fully without AI.
      </Card>
    </>
  );
}
