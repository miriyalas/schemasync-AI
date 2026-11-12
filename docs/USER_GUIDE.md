# User guide

## 1. New comparison

1. **Source (reference)**: the environment that is "right", usually DEV. Fill in engine, server, database (SQL Server) or service name + schema (Oracle), port, username and password.
2. **Target**: the environment to check, for example SIT.
3. Click **Test connection** on each. You should see "Connected to …". A warning about VIEW DEFINITION means the login cannot read code; ask your DBA for the grant in [SECURITY.md](SECURITY.md#database-logins).
4. **Save profile** stores everything except the password in this browser, for next time.
5. Pick **What to compare** (tables & columns, keys, foreign keys, checks, indexes, views, procedures, functions, triggers, table types, sequences & synonyms, packages).
6. **Options**:
   - *Ignore whitespace and comments*: recommended. Formatting changes are not reported.
   - *Ignore case and [brackets]*: recommended.
   - *AI review*: available when an AI provider is configured.
7. Click **Run comparison**. To try the app without a database, click **Try with demo data**.

## 2. Results

- **Tiles**: total, missing in target, extra in target, definition differences, high risk.
- **Summary**: how many objects look like noise, and which high-risk item to look at first.
- **Filters**: All / Missing / Extra / Diff / Noise chips, search (names and notes), type and risk dropdowns.
- **Risk** means *how risky it is to make the target match the source*:
  - **High**: can break callers, fail on existing data, or lose data;
  - **Medium**: logic change worth reviewing;
  - **Low**: additive or cosmetic;
  - **Noise**: backup, temp or test copy, usually skip.
- ✦ next to a note means AI wrote it; otherwise it comes from the rule-based checks.
- Click an object name to open its diff.

### Downloads

- **Download Excel**: sheets Summary, All Differences, Missing in Target, Extra in Target, Definition Diff, Columns, Keys & Indexes, Code Objects, Deploy Script.
- **Deploy script (.sql)**: SQL Server script in dependency order. Noise objects are left out unless you tick *Include noise objects*. Objects that exist only in the target are listed as commented-out DROPs. **Always review it and run it on a copy first.**

## 3. Object diff

- Left = target (current), right = source (reference). Red lines are removed, green lines added, hatched rows are padding.
- **Copy definition**, **Download .sql**, and **Convert to Oracle / SQL Server** (opens the converter with this code).

## 4. SQL Converter

1. Choose the direction with the ⇄ button (it also moves the last output into the input).
2. Paste SQL or arrive from an object page.
3. Tick **Use AI for procedural code** if available.
4. Click **Convert**.
5. Read **What changed** (Rule or AI), **Confidence** and **warnings**. Copy or download the result.
6. Test the converted code on a development database before using it.

## FAQ

**A procedure shows as DIFF but looks the same.** Make sure *Ignore whitespace and comments* is ticked. If it still differs, look for changed string literals: text inside quotes is always compared exactly.

**Hundreds of columns missing.** Columns are folded into a missing table automatically. Many missing columns on an *existing* table usually means the table was rebuilt in DEV.

**Comparison times out.** Select fewer object types, or host the app inside your network ([HOSTING.md](HOSTING.md)), where queries are faster and there is no platform time limit.

**Oracle shows fewer objects than expected.** Without `SELECT ANY DICTIONARY` the app uses `ALL_*` views and only sees objects the login can access (a warning is shown).
