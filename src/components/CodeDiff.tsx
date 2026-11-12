"use client";

import { diffLines } from "diff";
import { useMemo } from "react";

type Kind = "same" | "add" | "del" | "gap";
interface Cell {
  n?: number;
  text: string;
  kind: Kind;
}

const ROW: Record<Kind, string> = {
  same: "bg-white",
  add: "bg-[#e6f4ea]",
  del: "bg-[#fdecec]",
  gap: "bg-[repeating-linear-gradient(135deg,#f3f4f6_0_6px,#fafafb_6px_12px)]",
};

function split(v: string): string[] {
  const lines = v.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Side-by-side diff: left = target (old), right = source (new). Changed blocks are aligned row by row. */
export function SideBySideDiff({ left, right, ignoreWhitespace }: { left: string; right: string; ignoreWhitespace?: boolean }) {
  const rows = useMemo(() => {
    const parts = diffLines(left, right, { ignoreWhitespace: !!ignoreWhitespace });
    const out: [Cell, Cell][] = [];
    let ln = 0;
    let rn = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p.added && !p.removed) {
        for (const t of split(p.value)) out.push([{ n: ++ln, text: t, kind: "same" }, { n: ++rn, text: t, kind: "same" }]);
        continue;
      }
      const removed = p.removed ? split(p.value) : [];
      const nxt = parts[i + 1];
      const added = p.removed && nxt?.added ? split(nxt.value) : p.added ? split(p.value) : [];
      if (p.removed && nxt?.added) i++;
      const max = Math.max(removed.length, added.length);
      for (let k = 0; k < max; k++)
        out.push([
          k < removed.length ? { n: ++ln, text: removed[k], kind: "del" } : { text: "", kind: "gap" },
          k < added.length ? { n: ++rn, text: added[k], kind: "add" } : { text: "", kind: "gap" },
        ]);
    }
    return out;
  }, [left, right, ignoreWhitespace]);

  return (
    <div className="overflow-auto max-h-[720px]">
      <table className="w-full min-w-[760px] border-collapse font-mono text-[12.5px] leading-6 table-fixed">
        <colgroup>
          <col className="w-11" />
          <col className="w-4" />
          <col />
          <col className="w-11" />
          <col className="w-4" />
          <col />
        </colgroup>
        <tbody>
          {rows.map(([l, r], i) => (
            <tr key={i}>
              <LineCells c={l} mark="−" markClass="text-red-800" border />
              <LineCells c={r} mark="+" markClass="text-green-800" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LineCells({ c, mark, markClass, border }: { c: Cell; mark: string; markClass: string; border?: boolean }) {
  const bg = ROW[c.kind];
  return (
    <>
      <td className={`${bg} text-right pr-2 text-gray-500 select-none align-top`}>{c.n ?? ""}</td>
      <td className={`${bg} font-bold select-none align-top ${markClass}`}>{c.kind === "add" || c.kind === "del" ? mark : ""}</td>
      <td className={`${bg} pr-3 whitespace-pre overflow-hidden text-ellipsis align-top ${border ? "border-r border-line" : ""}`} title={c.text}>
        {c.text}
      </td>
    </>
  );
}

/** Read-only code block with line numbers. */
export function CodeView({ code }: { code: string }) {
  const lines = split(code);
  return (
    <div className="overflow-auto max-h-[720px]">
      <table className="w-full border-collapse font-mono text-[12.5px] leading-6">
        <tbody>
          {lines.map((t, i) => (
            <tr key={i}>
              <td className="w-11 text-right pr-3 text-gray-500 select-none align-top">{i + 1}</td>
              <td className="pr-3 whitespace-pre">{t}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Plain, dependency-free SQL editor (textarea with line numbers). */
export function SqlEditor({ value, onChange, readOnly, height = 440, label }: { value: string; onChange?: (v: string) => void; readOnly?: boolean; height?: number; label: string }) {
  const count = Math.max(value.split("\n").length, 1);
  return (
    <div className="flex overflow-auto font-mono text-[13px] leading-[1.7]" style={{ height }}>
      <div aria-hidden="true" className="select-none text-right text-gray-500 pl-3 pr-3 pt-3 bg-gray-50 border-r border-line min-w-12">
        {Array.from({ length: count }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        aria-label={label}
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        wrap="off"
        onChange={(e) => onChange?.(e.target.value)}
        className={`flex-1 resize-none border-0 outline-none p-3 font-mono text-[13px] leading-[1.7] whitespace-pre overflow-hidden ${readOnly ? "bg-[#fbfcfd]" : "bg-white"}`}
        style={{ height: Math.max(height, count * 22.1 + 24) }}
      />
    </div>
  );
}
