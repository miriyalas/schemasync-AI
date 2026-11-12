import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { DiffStatus, Risk } from "@/lib/types";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export const btn = {
  primary:
    "inline-flex items-center justify-center gap-2 min-h-11 px-5 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed",
  secondary:
    "inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-lg border border-gray-300 bg-white text-sm font-medium text-ink hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed",
  small:
    "inline-flex items-center justify-center gap-1.5 min-h-9 px-3 rounded-lg border border-gray-300 bg-white text-[13px] font-medium text-ink hover:bg-gray-50 disabled:opacity-50",
};

export function Button({ variant = "secondary", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof btn }) {
  return <button type="button" {...p} className={cx(btn[variant], className)} />;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("bg-white border border-line rounded-xl", className)}>{children}</div>;
}

const STATUS: Record<DiffStatus, string> = {
  MISSING: "bg-red-50 text-red-800",
  EXTRA: "bg-amber-100 text-amber-900",
  DIFF: "bg-blue-100 text-blue-800",
};
const RISK: Record<Risk, string> = {
  High: "bg-red-50 text-red-800",
  Medium: "bg-amber-100 text-amber-900",
  Low: "bg-green-100 text-green-800",
  Noise: "bg-violet-100 text-violet-800",
};

export function StatusBadge({ status }: { status: DiffStatus }) {
  return <span className={cx("inline-block text-xs font-bold tracking-wide px-2 py-1 rounded-md", STATUS[status])}>{status}</span>;
}

export function RiskBadge({ risk }: { risk: Risk }) {
  return <span className={cx("inline-block text-xs font-bold px-2 py-1 rounded-md", RISK[risk])}>{risk}</span>;
}

export function EnvPill({ children, tone }: { children: ReactNode; tone: "source" | "target" }) {
  return (
    <span className={cx("inline-block text-xs font-semibold px-2.5 py-1 rounded-full", tone === "source" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-900")}>
      {children}
    </span>
  );
}

export function PageHeader({ crumb, title, subtitle, actions }: { crumb?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {crumb && <div className="text-[13px] text-muted mb-1.5">{crumb}</div>}
        <h1 className="m-0 text-[28px] font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 mb-0 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2.5">{actions}</div>}
    </header>
  );
}

export function Sparkle({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    </svg>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return <div role="alert" className="whitespace-pre-line rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{children}</div>;
}
