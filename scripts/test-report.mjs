/**
 * Runs the unit tests with coverage and writes public/quality.json, which the
 * "Quality & tests" page shows. Exits with the test exit code, so a build that
 * runs this script (npm run build) fails when any test fails.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const tmp = path.join(root, ".test-results.json");
const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");

const run = spawnSync(
  process.execPath,
  [vitest, "run", "--reporter=default", "--reporter=json", `--outputFile.json=${tmp}`, "--coverage", "--coverage.reporter=json-summary", "--coverage.reporter=text-summary"],
  { stdio: "inherit", env: { ...process.env, CI: "1" } }
);

const rel = (p) => path.relative(root, p).split(path.sep).join("/");
let report = { generatedAt: new Date().toISOString(), success: false, totals: { files: 0, tests: 0, passed: 0, failed: 0, skipped: 0 }, coverage: null, files: [] };

if (existsSync(tmp)) {
  const r = JSON.parse(readFileSync(tmp, "utf8"));
  report.success = !!r.success;
  report.totals = {
    files: r.numTotalTestSuites !== undefined ? r.testResults.length : 0,
    tests: r.numTotalTests,
    passed: r.numPassedTests,
    failed: r.numFailedTests,
    skipped: (r.numPendingTests || 0) + (r.numTodoTests || 0),
  };
  report.files = r.testResults.map((f) => ({
    file: rel(f.name),
    status: f.status,
    tests: f.assertionResults.map((a) => ({
      suite: (a.ancestorTitles || []).join(" › "),
      title: a.title,
      status: a.status,
      ms: Math.round((a.duration || 0) * 10) / 10,
      failure: (a.failureMessages || []).join("\n").slice(0, 800) || undefined,
    })),
  }));
  rmSync(tmp, { force: true });
}

const cov = path.join(root, "coverage", "coverage-summary.json");
if (existsSync(cov)) {
  const t = JSON.parse(readFileSync(cov, "utf8")).total;
  report.coverage = { lines: t.lines.pct, statements: t.statements.pct, functions: t.functions.pct, branches: t.branches.pct };
}

mkdirSync(path.join(root, "public"), { recursive: true });
writeFileSync(path.join(root, "public", "quality.json"), JSON.stringify(report, null, 2));
console.log(`\nquality.json written: ${report.totals.passed}/${report.totals.tests} tests passed.`);
process.exit(run.status ?? 1);
