import type { ConnectionInput, ObjectType, Snapshot } from "../types";
import { snapshotSqlServer, testSqlServer } from "./sqlserver";
import { snapshotOracle, testOracle } from "./oracle";

export function validateConnection(c: ConnectionInput | undefined, role: string): string | null {
  if (!c) return `${role} connection is missing.`;
  if (!c.host) return `${role}: server / host is required.`;
  if (!c.user) return `${role}: username is required.`;
  if (c.engine === "sqlserver" && !c.database) return `${role}: database name is required.`;
  if (c.engine === "oracle" && !c.serviceName && !c.database) return `${role}: Oracle service name is required.`;
  return null;
}

export async function testConnection(c: ConnectionInput) {
  return c.engine === "oracle" ? testOracle(c) : testSqlServer(c);
}

export async function takeSnapshot(c: ConnectionInput, wanted: Set<ObjectType>): Promise<Snapshot> {
  return c.engine === "oracle" ? snapshotOracle(c, wanted) : snapshotSqlServer(c, wanted);
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
