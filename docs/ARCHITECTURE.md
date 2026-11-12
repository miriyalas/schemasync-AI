# Architecture

## Overview

```
┌─────────────────────────── Browser ───────────────────────────┐
│ New comparison ─► Results ─► Object diff        SQL Converter │
│        │             │  ▲                              │      │
│        │   Excel + deploy script built here            │      │
└────────┼─────────────┼──┼──────────────────────────────┼──────┘
         │ POST         │  │ POST /api/ai/review          │ POST /api/convert
         ▼ /api/compare │  │ (batches of 20)              ▼
┌──────────────────────────── Next.js server (API routes) ────────────────────┐
│ db/sqlserver.ts ─┐                                                          │
│ db/oracle.ts  ───┼─► Snapshot A, Snapshot B ─► compare.ts ─► analyze.ts     │
│ demo.ts ─────────┘   (DbObject[])             (match, diff)  (risk, noise)  │
│                                                                             │
│ aiReview.ts ─► ai.ts ─► Anthropic | OpenAI | Azure OpenAI | Ollama          │
│ converter/ (rules) ─► ai.ts (procedural code only)                          │
└─────────────────────────────────────────────────────────────────────────────┘
         │ read-only catalog queries
         ▼
   SQL Server (sys.*)   Oracle (DBA_* / ALL_*)
```

## Design decisions

| Decision | Why |
|---|---|
| **Single Next.js app** (no separate backend) | One deployable unit; runs on Vercel or one Docker container |
| **Pure-JS drivers** (`mssql`/tedious, `oracledb` Thin) | No native clients to install; works on Vercel |
| **Snapshot → compare** | Each database is read once into a neutral `DbObject[]` model, so SQL Server and Oracle share one compare engine |
| **Rules first, AI second** | Exact facts (missing / different) come from code. AI only explains, classifies and finishes procedural conversion, so results stay correct without AI |
| **Normalise before comparing code** | Formatting-only changes were the biggest source of false `DIFF`s |
| **Constraint identity by columns** | Auto-generated names (`PK__T__3214EC07…`) differ per environment |
| **Oracle owner ignored in keys** | Schemas are usually named per environment (`APP_DEV`, `APP_SIT`) |
| **Excel and deploy script built in the browser** | Avoids server response-size limits; no data stored on the server |
| **Stateless server** | Passwords travel with each request and are never written anywhere |

## Data model (`src/lib/types.ts`)

- **`DbObject`**: one object from one database: `type`, `schema`, `parent` (table for columns/keys/indexes), `name`, `def` (comparable definition or SQL text), `code` flag, `meta` (structured details for the deploy script).
- **`Snapshot`**: all objects of one database plus warnings.
- **`DiffItem`**: one difference: status, both definitions, line counts, risk, noise, note, `aiReviewed`.
- **`CompareResult`**: items + summary (by status, type, risk) + warnings + options.

## Compare algorithm (`src/lib/compare.ts`)

1. Keep only selected object types; build a map `type|schema.parent.name` (lower-case; Oracle without owner) for each side.
2. **MISSING** = key only in source; **EXTRA** = key only in target. Children (columns, PK, table-type columns) of a missing/extra parent are folded into the parent.
3. **DIFF** = key in both and definitions differ: code via `normalizeSql`, other objects by text (case-insensitive if selected).
4. `analyzeItem` assigns noise, risk and a note.
5. Sort by dependency order, then status, then name; build the summary.

## Request flow for a comparison

1. Browser posts both connections and options to `/api/compare`.
2. Both snapshots are taken **in parallel**; the queries for each database also run in parallel (SQL Server) or one after another on one connection (Oracle).
3. The result returns as JSON and is kept in memory and sessionStorage.
4. If AI is on, the browser sends up to 150 items in batches of 20 to `/api/ai/review` and merges the answers.
5. Excel and the deploy script are generated client-side on demand.

## Folder map

See the project structure in the [README](../README.md#project-structure).
