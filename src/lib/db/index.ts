import type { ConnectionInput, ObjectType, Snapshot } from "../types";

/*
 * Database drivers are loaded only when a real connection is used, so demo mode and the
 * converter never depend on them, and a driver problem is reported as a clear error.
 */

export function validateConnection(c: ConnectionInput | undefined, role: string): string | null {
  if (!c) return `${role} connection is missing.`;
  if (!c.host) return `${role}: server / host is required.`;
  if (!c.user) return `${role}: username is required.`;
  if (c.engine === "sqlserver" && !c.database) return `${role}: database name is required.`;
  if (c.engine === "oracle" && !c.serviceName && !c.database) return `${role}: Oracle service name is required.`;
  return null;
}

async function loadDriver(engine: ConnectionInput["engine"]) {
  try {
    return engine === "oracle" ? { oracle: await import("./oracle") } : { sqlserver: await import("./sqlserver") };
  } catch (e) {
    throw new Error(`Could not load the ${engine === "oracle" ? "Oracle" : "SQL Server"} driver on this server: ${(e as Error).message}`);
  }
}

export async function testConnection(c: ConnectionInput) {
  const d = await loadDriver(c.engine);
  return d.oracle ? d.oracle.testOracle(c) : d.sqlserver!.testSqlServer(c);
}

export async function takeSnapshot(c: ConnectionInput, wanted: Set<ObjectType>): Promise<Snapshot> {
  const d = await loadDriver(c.engine);
  return d.oracle ? d.oracle.snapshotOracle(c, wanted) : d.sqlserver!.snapshotSqlServer(c, wanted);
}

/** Turn driver errors into a message a user can act on. Never includes the password. */
export function friendlyDbError(e: unknown, label: string): string {
  const msg = (e as Error)?.message || String(e);
  if (/ETIMEOUT|ETIMEDOUT|timeout|NJS-510|NJS-503/i.test(msg))
    return `${label}: could not reach the server (timeout). Check host/port and that the server allows connections from where this app runs.`;
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ESOCKET|Could not connect|NJS-511|NJS-501/i.test(msg))
    return `${label}: server not found or connection refused. Check host and port.`;
  if (/Login failed|ORA-01017|ELOGIN/i.test(msg)) return `${label}: login failed. Check username and password.`;
  return `${label}: ${msg}`;
}
