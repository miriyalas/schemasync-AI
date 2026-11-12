import { NextResponse } from "next/server";
import { convertSql } from "@/lib/converter";
import type { Engine } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { sql, from, to, useAI } = (await req.json()) as { sql: string; from: Engine; to: Engine; useAI?: boolean };
  if (!sql || !sql.trim()) return NextResponse.json({ error: "Paste some SQL first." }, { status: 400 });
  if (sql.length > 200_000) return NextResponse.json({ error: "SQL is too large (max 200 KB)." }, { status: 400 });
  try {
    return NextResponse.json(await convertSql(sql, from, to, !!useAI));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
