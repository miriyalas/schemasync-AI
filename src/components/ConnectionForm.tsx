"use client";

import { useState } from "react";
import type { Profile } from "@/lib/profiles";
import type { ConnectionInput } from "@/lib/types";
import { Button, Card, EnvPill } from "./ui";

const field = "min-h-11 w-full min-w-0 px-3 border border-gray-300 rounded-lg text-sm bg-white text-ink";
const lbl = "flex flex-col gap-1.5 text-[13px] font-medium text-gray-700";

interface TestResult {
  ok: boolean;
  version?: string;
  database?: string;
  canViewDefinition?: boolean;
  error?: string;
}

export function ConnectionForm({
  title,
  tone,
  value,
  onChange,
  profiles,
  onSaveProfile,
}: {
  title: string;
  tone: "source" | "target";
  value: ConnectionInput;
  onChange: (c: ConnectionInput) => void;
  profiles: Profile[];
  onSaveProfile: (c: ConnectionInput) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const set = (patch: Partial<ConnectionInput>) => {
    setTest(null);
    onChange({ ...value, ...patch });
  };
  const isOracle = value.engine === "oracle";
  const id = (s: string) => `${tone}-${s}`;

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const r = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connection: value }),
      });
      setTest(await r.json());
    } catch (e) {
      setTest({ ok: false, error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card className="p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-[17px] font-semibold">{title}</h2>
        <EnvPill tone={tone}>{value.label || (tone === "source" ? "SOURCE" : "TARGET")}</EnvPill>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className={lbl} htmlFor={id("profile")}>
          Saved profile
          <select
            id={id("profile")}
            className={field}
            value=""
            onChange={(e) => {
              const p = profiles.find((x) => x.label === e.target.value);
              if (p) set({ ...p, password: "" });
            }}
          >
            <option value="">{profiles.length ? "Load a profile…" : "No saved profiles"}</option>
            {profiles.map((p) => (
              <option key={p.label} value={p.label}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className={lbl} htmlFor={id("label")}>
          Environment name
          <input id={id("label")} className={field} value={value.label} placeholder="DEV" onChange={(e) => set({ label: e.target.value })} />
        </label>
      </div>

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
        <label className={lbl} htmlFor={id("host")}>
          Server / host
          <input id={id("host")} className={field} value={value.host} placeholder={isOracle ? "db-host.company.com" : "sqlserver.company.com"} onChange={(e) => set({ host: e.target.value })} />
        </label>
        <label className={lbl} htmlFor={id("engine")}>
          Engine
          <select id={id("engine")} className={field} value={value.engine} onChange={(e) => set({ engine: e.target.value as ConnectionInput["engine"], port: undefined })}>
            <option value="sqlserver">SQL Server</option>
            <option value="oracle">Oracle</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
        {isOracle ? (
          <label className={lbl} htmlFor={id("svc")}>
            Service name
            <input id={id("svc")} className={field} value={value.serviceName || ""} placeholder="ORCLPDB1" onChange={(e) => set({ serviceName: e.target.value })} />
          </label>
        ) : (
          <label className={lbl} htmlFor={id("db")}>
            Database
            <input id={id("db")} className={field} value={value.database || ""} placeholder="MyDatabase" onChange={(e) => set({ database: e.target.value })} />
          </label>
        )}
        <label className={lbl} htmlFor={id("port")}>
          Port
          <input
            id={id("port")}
            className={field}
            inputMode="numeric"
            value={value.port ?? ""}
            placeholder={isOracle ? "1521" : "1433"}
            onChange={(e) => set({ port: e.target.value ? Number(e.target.value.replace(/\D/g, "")) : undefined })}
          />
        </label>
      </div>

      {isOracle && (
        <label className={lbl} htmlFor={id("schema")}>
          Schema (owner) to compare
          <input id={id("schema")} className={field} value={value.schema || ""} placeholder="Defaults to the username" onChange={(e) => set({ schema: e.target.value })} />
        </label>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className={lbl} htmlFor={id("user")}>
          Username
          <input id={id("user")} className={field} autoComplete="off" value={value.user} placeholder="read-only login" onChange={(e) => set({ user: e.target.value })} />
        </label>
        <label className={lbl} htmlFor={id("pw")}>
          Password
          <input id={id("pw")} type="password" className={field} autoComplete="new-password" value={value.password} onChange={(e) => set({ password: e.target.value })} />
        </label>
      </div>

      {!isOracle && (
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-gray-700">
          <label className="flex items-center gap-2 min-h-8">
            <input type="checkbox" className="w-4 h-4 accent-brand" checked={value.encrypt ?? true} onChange={(e) => set({ encrypt: e.target.checked })} />
            Encrypt connection
          </label>
          <label className="flex items-center gap-2 min-h-8">
            <input
              type="checkbox"
              className="w-4 h-4 accent-brand"
              checked={value.trustServerCertificate ?? true}
              onChange={(e) => set({ trustServerCertificate: e.target.checked })}
            />
            Trust server certificate
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={runTest} disabled={testing || !value.host}>
          {testing ? "Testing…" : "Test connection"}
        </Button>
        <Button onClick={() => onSaveProfile(value)} disabled={!value.label || !value.host}>
          Save profile
        </Button>
        {test && (
          <span role="status" className={test.ok ? "text-[13px] text-green-800" : "text-[13px] text-red-800"}>
            {test.ok
              ? `Connected to ${test.database}${test.canViewDefinition === false ? " (warning: no VIEW DEFINITION permission)" : ""}`
              : test.error}
          </span>
        )}
      </div>
      {test?.ok && test.version && <div className="text-xs text-muted -mt-2 break-words">{test.version}</div>}
    </Card>
  );
}
