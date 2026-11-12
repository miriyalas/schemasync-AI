# Testing

The project uses **Vitest**. Tests live in `tests/` and run in Node with no database, network or API key: the database drivers and AI providers are mocked.

```bash
npm test                 # run all tests once
npm run test:watch       # re-run on save
npm run test:coverage    # coverage report in coverage/index.html
```

CI (`.github/workflows/ci.yml`) runs typecheck → tests with coverage → build on every push and pull request, and uploads the coverage report as an artifact.

**Current result:** 18 files, 300 tests, about 99% of lines covered in `src/lib` and `src/app/api`.

## Tests gate every deployment

`npm run build` first runs `scripts/test-report.mjs` (all tests + coverage). **If any test fails, the build stops**, so Vercel, Docker and CI never deploy untested code. The script also writes `public/quality.json`, which the app shows on the **Quality & tests** page (every test, pass/fail, timings, coverage).

| Command | What it does |
|---|---|
| `npm run build` | tests + coverage + report, then the Next.js build |
| `npm run test:report` | tests + coverage + `public/quality.json` only |
| `npm run build:skip-tests` | build without tests (emergencies only) |

## Live self-check (in the app)

**Quality & tests → Run live self-check** calls `/api/self-test`. The running server executes 21 checks with known inputs and expected outputs (compare counts, normalisation, noise detection, risk levels, converter output, deploy-script order and safety) and shows expected vs actual for each. It needs no database or API key, so anyone can verify a deployment in one click.

## Test files

| File | What it covers |
|---|---|
| `sqlScanner.test.ts` | SQL lexer (strings, `N''`, comments, `[ ]`/`" "` identifiers), normalisation, display formatting |
| `analyze.test.ts` | Noise detection (backup, temp, test, dated, Copilot names), rule-based risk for every type × status |
| `compare.test.ts` | Compare engine: MISSING/EXTRA/DIFF, normalisation on/off, case-insensitive names, parent/child folding, Oracle owner handling, cross-engine warnings, sorting, summary, demo data end to end |
| `converter.helpers.test.ts` | String/comment protection, argument splitting, nested call replacement, change log, validation |
| `converter.tsqlToOracle.test.ts` | Every T-SQL → Oracle rule: functions, DATEADD/DATEDIFF parts, TOP → FETCH, `+` → `\|\|`, all data types, NOLOCK, GO, PRINT, transactions, binds, DUAL, procedures |
| `converter.oracleToTsql.test.ts` | Every Oracle → T-SQL rule: NVL/NVL2/DECODE/SUBSTR/INSTR/TO_*, FETCH → TOP, OFFSET kept, `\|\|` → `+`, data types, identity, DATE/TIMESTAMP literals, warnings (ROWNUM, CONNECT BY, (+), DATE) |
| `converter.ai.test.ts` | AI step of the converter: when it is called, prompt content, merge of AI changes, fallback on error, empty answers, AI not configured |
| `deployScript.test.ts` | Deployment script order, dependency sorting, CREATE TABLE/TYPE, column ALTERs, keys, checks, indexes, sequences, synonyms, FKs, noise exclusion, EXTRA as comments, circular references |
| `ai.test.ts` | Provider config and request format for Anthropic, OpenAI, Azure OpenAI, Ollama; HTTP errors; JSON parsing |
| `aiReview.test.ts` | Prompt trimming, AI result validation, merging reviews into results |
| `db.sqlserver.test.ts` | SQL Server metadata extraction with a mocked `mssql`: types, columns, PK/UQ/FK/CK naming, indexes, modules, table types, sequences, synonyms, selective queries, query failures |
| `db.oracle.test.ts` | Oracle extraction with a mocked `oracledb`: DBA_/ALL_ fallback, owner binding, types, identity, constraints, index filtering, source joining |
| `db.index.test.ts` | Connection validation and user-friendly error messages |
| `api.test.ts` | Every API route: demo compare, validation, success and 502 failures, test-connection, convert limits, AI status/review |
| `middleware.test.ts` | Optional Basic Auth (off, on, wrong user/password, malformed header) |
| `selfTest.test.ts` | Every live self-check passes; the endpoint returns JSON |
| `http.test.ts` | Readable errors when a host returns an HTML error page (500, timeout, 404, 401, network) |
| `db.lazy.test.ts` | Drivers load only when used; a driver failure becomes a clear message |

## Scenario catalogue

### Schema compare

| # | Scenario | Expected |
|---|---|---|
| C1 | Identical schemas | 0 differences |
| C2 | Object only in source | `MISSING`, source definition kept, added lines counted |
| C3 | Object only in target | `EXTRA`, target definition kept |
| C4 | Same object, different logic | `DIFF` with +/− line counts |
| C5 | Only whitespace / comments / case / brackets differ | No difference (normalisation on); `DIFF` when normalisation is off |
| C6 | `CREATE OR ALTER` vs `CREATE`, `PROC` vs `PROCEDURE`, trailing `GO` | Treated as equal |
| C7 | Name case differs (`GetX` vs `getx`) | Matched |
| C8 | Table missing in target | One `MISSING` table item; its columns folded in (no 20 extra rows) |
| C9 | Column missing on an existing table | Separate `MISSING` column item |
| C10 | Auto-named constraints (`PK__T__3214EC07…`) differ per environment | Matched by table/columns, no false difference |
| C11 | Oracle schemas `APP_DEV` vs `APP_SIT` | Matched (owner ignored) |
| C12 | Source and target on different engines | Warning added |
| C13 | One catalog query fails (permissions) | Warning, the rest of the comparison continues |
| C14 | Encrypted / unreadable module | Placeholder definition and a warning |
| C15 | Only some object types selected | Only those queries run; only those types reported |

### Risk and noise

| # | Scenario | Expected |
|---|---|---|
| R1 | Name with a date (`_3rdMarch2026`, `_20240115`), `_bak`, `_old`, `_copy`, `_test`, `_Copilot`, `TEMP…` | `Noise` |
| R2 | Legit names (`Template`, `Temperature`, `IsDeleted`, `Old_Value`, `Summary`, `TestResult`) | Not noise |
| R3 | New NOT NULL column without default | `High` |
| R4 | Column type change / becomes NOT NULL | `High` |
| R5 | Procedure / function parameters or RETURNS changed | `High` |
| R6 | Body-only change | `Medium` |
| R7 | Table or column only in target | `High` (data loss if dropped) |
| R8 | Table type changed | `High` |

### Converter

| # | Scenario | Expected |
|---|---|---|
| V1 | Plain query with T-SQL functions | Fully converted, confidence `High`, no AI call |
| V2 | `TOP` with `DISTINCT`, `PERCENT`, `WITH TIES`, in subquery, before `;` | Correct `FETCH FIRST` placement |
| V3 | `CASE … ELSE … END` after `TOP` | `FETCH` placed after the whole statement |
| V4 | Text inside strings/comments looks like SQL | Never changed |
| V5 | Words containing type names (`Point`, `IntValue`, `INTO`) | Not changed |
| V6 | Procedure, AI off | Rule draft, `Low` confidence, clear warning |
| V7 | Procedure, AI on | AI result merged, AI changes labelled "AI" |
| V8 | AI fails / returns nothing | Rule draft kept, warning shown |
| V9 | Oracle `FETCH` with `OFFSET` | Kept (SQL Server supports it) |
| V10 | Oracle-only features (`ROWNUM`, `CONNECT BY`, `(+)`, `DATE`) | Warning with advice |
| V11 | Unbalanced brackets / quotes in the result | Validation fails with a message |
| V12 | Empty or >200 KB input | HTTP 400 |

### Deployment script

| # | Scenario | Expected |
|---|---|---|
| D1 | Mixed differences | Order: types → sequences → tables → columns → keys → indexes → code → FKs → synonyms |
| D2 | Function used by another function | Dependency created first |
| D3 | Circular references | No infinite loop, each object once |
| D4 | Noise objects | Excluded unless "include noise" is ticked |
| D5 | Objects only in target | Commented-out `DROP` only |
| D6 | Identity / computed column changed | Not altered; manual note |

### API and security

| # | Scenario | Expected |
|---|---|---|
| A1 | Demo compare | 200, results without a database |
| A2 | Missing host / user / database / service name | 400 with a clear message |
| A3 | Database unreachable / login failed | Friendly message, no password in output |
| A4 | AI review when AI is off | 400 |
| A5 | AI review batch > 30 items | Trimmed to 30 |
| S1 | `APP_PASSWORD` not set | Open |
| S2 | `APP_PASSWORD` set, no / wrong credentials | 401 with Basic challenge |
| A6 | Host returns an HTML error page (Vercel 500/504) | Clear message instead of "Unexpected token '<'" |
| A7 | Unexpected exception or invalid request body in any route | JSON error, never an HTML page |
| A8 | Demo mode | Works even if the database drivers cannot load |

## Manual checks against real databases (before go-live)

Automated tests use mocks, so run these once against real servers:

1. **Test connection** for DEV and SIT: shows the version and no "VIEW DEFINITION" warning.
2. Create a scratch schema in DEV and SIT, then add one example of each: a missing table, an extra column, a changed procedure, a missing index, an FK, a table type. Run the comparison and confirm each appears once with the right status.
3. Change only whitespace in a procedure in SIT: it must **not** appear.
4. Download Excel: all 9 sheets open, colours and filters work.
5. Run the deploy script against a **copy** of SIT, then compare again: only noise / EXTRA items remain.
6. Oracle: compare `APP_DEV` vs `APP_SIT` schemas; check packages and sequences.
7. AI: with a key set, the results page shows "reviewed by AI" and sparkle icons.

## Writing new tests

- Put them in `tests/<area>.test.ts` and import from `@/lib/...`.
- Build fake objects with the helpers in `tests/helpers.ts` (`snap`, `proc`, `tbl`, `col`, `item`, `opts`).
- Mock drivers and AI with `vi.mock` + `vi.hoisted` (see `db.sqlserver.test.ts` and `converter.ai.test.ts`).
- When you fix a bug, add a test that failed before the fix.
