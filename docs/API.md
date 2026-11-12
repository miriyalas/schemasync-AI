# API reference

All endpoints are under `/api`, accept and return JSON, and run on the Node.js runtime. If `APP_PASSWORD` is set, send HTTP Basic credentials.

## `POST /api/compare`

```json
{
  "source": { "engine": "sqlserver", "label": "DEV", "host": "dev-sql", "port": 1433, "database": "App", "user": "ro", "password": "…", "encrypt": true, "trustServerCertificate": true },
  "target": { "engine": "oracle", "label": "SIT", "host": "ora-sit", "port": 1521, "serviceName": "PDB1", "schema": "APP_SIT", "user": "ro", "password": "…" },
  "options": { "groups": ["tables", "keys", "procedures"], "ignoreWhitespace": true, "ignoreCase": true },
  "demo": false
}
```

- `demo: true` ignores the connections and uses built-in sample databases.
- `groups`: `tables`, `keys`, `foreignKeys`, `checks`, `indexes`, `views`, `procedures`, `functions`, `triggers`, `tableTypes`, `sequences`, `packages`.

**200** → `CompareResult`:

```json
{
  "source": { "label": "DEV", "engine": "sqlserver" },
  "target": { "label": "SIT", "engine": "sqlserver" },
  "generatedAt": "2026-11-12T10:00:00.000Z",
  "options": { "groups": ["…"], "ignoreWhitespace": true, "ignoreCase": true },
  "summary": { "total": 3, "missing": 1, "extra": 1, "diff": 1, "noise": 0,
               "byType": { "StoredProcedure": { "missing": 1, "extra": 1, "diff": 1 } },
               "byRisk": { "High": 0, "Medium": 2, "Low": 1, "Noise": 0 } },
  "items": [{ "id": "DIFF|StoredProcedure|dbo.p", "type": "StoredProcedure", "schema": "dbo", "name": "p",
              "fullName": "dbo.p", "status": "DIFF", "sourceDef": "…", "targetDef": "…",
              "added": 2, "removed": 1, "risk": "Medium", "noise": false, "note": "Body changed …" }],
  "warnings": []
}
```

**400** invalid connection · **502** a database could not be read: `{ "error": "SIT: login failed. Check username and password." }`

## `POST /api/test-connection`

`{ "connection": ConnectionInput }` → `{ "ok": true, "version": "…", "database": "App", "canViewDefinition": true }` or `{ "ok": false, "error": "…" }`.

## `POST /api/convert`

`{ "sql": "SELECT TOP 5 …", "from": "sqlserver", "to": "oracle", "useAI": true }` →

```json
{ "sql": "SELECT … FETCH FIRST 5 ROWS ONLY", "from": "sqlserver", "to": "oracle",
  "changes": [{ "from": "TOP 5", "to": "FETCH FIRST 5 ROWS ONLY", "by": "Rule" }],
  "warnings": [], "confidence": "High", "usedAI": false, "procedural": false,
  "validation": { "ok": true, "messages": ["Brackets and quotes are balanced."] } }
```

**400** empty or larger than 200 KB.

## `GET /api/ai/status`

`{ "enabled": true, "provider": "anthropic", "model": "claude-sonnet-5-5" }`

## `POST /api/ai/review`

`{ "items": ReviewInput[] }` (max 30 per call) → `{ "items": [{ "id": "…", "risk": "High", "isNoise": false, "note": "…" }] }`.
**400** AI not configured · **502** provider error.
