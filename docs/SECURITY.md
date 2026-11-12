# Security

## What the app does with your data

- Runs **read-only** catalog queries (`sys.*` on SQL Server, `DBA_*`/`ALL_*` on Oracle). It never reads table rows and never writes to your databases. The deploy script is only generated, never executed.
- **Passwords** are sent with each request over HTTPS and used only for that request. They are never logged or stored on the server. Saved profiles in the browser exclude the password.
- **AI** (optional) receives object names, SQL definitions and diff hunks, **never table data**. Use `AI_PROVIDER=ollama` (local model) or `azure` (your tenant) if code must not leave your boundary, or `none` to turn AI off.
- Comparison results stay in the browser (memory + sessionStorage, cleared when the tab closes).

## Database logins

Create dedicated read-only logins.

**SQL Server** (in each database):

```sql
CREATE LOGIN schemasync_ro WITH PASSWORD = '<strong password>', CHECK_POLICY = ON;
CREATE USER schemasync_ro FOR LOGIN schemasync_ro;
GRANT VIEW DEFINITION TO schemasync_ro;   -- read object definitions, no data access
```

**Oracle**:

```sql
CREATE USER schemasync_ro IDENTIFIED BY "<strong password>";
GRANT CREATE SESSION TO schemasync_ro;
GRANT SELECT ANY DICTIONARY TO schemasync_ro;   -- read DBA_* views, no table data
```

## Protecting the app

- Set `APP_PASSWORD` (HTTP Basic Auth on every page and API), or put the app behind your SSO / VPN / IIS Windows authentication.
- Serve it over **HTTPS** only.
- Keep `.env` files out of Git (already in `.gitignore`); use Vercel / Azure / Kubernetes secret stores.
- Rotate any key or password that was ever committed.

## Reporting a problem

Open a private security advisory in the GitHub repository (**Security → Advisories → New draft advisory**) rather than a public issue.
