import { NextResponse } from "next/server";
import { compareSnapshots, wantedTypes } from "@/lib/compare";
import { friendlyDbError, takeSnapshot, validateConnection } from "@/lib/db";
import { demoSnapshots } from "@/lib/demo";
import type { CompareOptions, ConnectionInput, Snapshot } from "@/lib/types";

export const runtime = "nodejs";
// Large databases take time. Vercel Hobby allows up to 60 s; Pro up to 300 s.
export const maxDuration = 60;

interface Body {
  source?: ConnectionInput;
  target?: ConnectionInput;
  options: CompareOptions;
  demo?: boolean;
}

export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (e) {
    console.error("compare failed", e);
    return NextResponse.json({ error: `Comparison failed on the server: ${(e as Error).message}` }, { status: 500 });
  }
}

async function handle(req: Request) {
  const body = (await req.json()) as Body;
  const options: CompareOptions = {
    groups: body.options?.groups?.length ? body.options.groups : ["tables", "keys", "foreignKeys", "indexes", "views", "procedures", "functions", "tableTypes"],
    ignoreWhitespace: body.options?.ignoreWhitespace ?? true,
    ignoreCase: body.options?.ignoreCase ?? true,
  };

  let source: Snapshot;
  let target: Snapshot;

  if (body.demo) {
    ({ source, target } = demoSnapshots());
  } else {
    const err = validateConnection(body.source, "Source") || validateConnection(body.target, "Target");
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    const wanted = wantedTypes(options);
    const s = body.source!;
    const t = body.target!;
    const [rs, rt] = await Promise.allSettled([takeSnapshot(s, wanted), takeSnapshot(t, wanted)]);
    const errors = [
      rs.status === "rejected" ? friendlyDbError(rs.reason, s.label || "Source") : null,
      rt.status === "rejected" ? friendlyDbError(rt.reason, t.label || "Target") : null,
    ].filter(Boolean);
    if (errors.length) return NextResponse.json({ error: errors.join("\n") }, { status: 502 });
    source = (rs as PromiseFulfilledResult<Snapshot>).value;
    target = (rt as PromiseFulfilledResult<Snapshot>).value;
  }

  return NextResponse.json(compareSnapshots(source, target, options));
}
