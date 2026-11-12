import { NextResponse } from "next/server";
import { aiConfig } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { provider, model, enabled } = aiConfig();
  return NextResponse.json({ enabled, provider, model });
}
