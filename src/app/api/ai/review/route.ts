import { NextResponse } from "next/server";
import { aiConfig } from "@/lib/ai";
import { reviewWithAi, type ReviewInput } from "@/lib/aiReview";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!aiConfig().enabled) return NextResponse.json({ error: "AI is not configured." }, { status: 400 });
  let items: ReviewInput[];
  try {
    ({ items } = (await req.json()) as { items: ReviewInput[] });
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!Array.isArray(items) || !items.length) return NextResponse.json({ items: [] });
  try {
    return NextResponse.json({ items: await reviewWithAi(items.slice(0, 30)) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
