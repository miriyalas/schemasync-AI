import { NextResponse } from "next/server";
import { friendlyDbError, testConnection, validateConnection } from "@/lib/db";
import type { ConnectionInput } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  let connection: ConnectionInput;
  try {
    ({ connection } = (await req.json()) as { connection: ConnectionInput });
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const invalid = validateConnection(connection, connection?.label || "Connection");
  if (invalid) return NextResponse.json({ ok: false, error: invalid }, { status: 400 });
  try {
    return NextResponse.json(await testConnection(connection));
  } catch (e) {
    return NextResponse.json({ ok: false, error: friendlyDbError(e, connection.label || "Connection") }, { status: 200 });
  }
}
