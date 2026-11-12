"use client";

import Link from "next/link";
import type React from "react";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const NAV = [
  { href: "/", label: "New comparison", icon: <path d="M7 4v16M7 4L4 7M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3" /> },
  { href: "/results", label: "Results", icon: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /> },
  { href: "/converter", label: "SQL Converter", icon: <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" /> },
];

const ABOUT = [
  { href: "/quality", label: "Quality & tests", icon: <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3zM9 12l2 2 4-4" /> },
  { href: "/tech-stack", label: "Tech stack", icon: <path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5" /> },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex-[1_1_232px] max-w-full bg-gray-900 text-gray-200 px-4 py-6 flex flex-col gap-1">
      <Link href="/" className="flex items-center gap-2.5 px-2 pb-6 no-underline">
        <span className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 8h14l-3-3M20 16H6l3 3" />
          </svg>
        </span>
        <span className="font-bold text-base text-white">SchemaSync AI</span>
      </Link>
      <div className="text-[11px] tracking-widest uppercase text-gray-400 px-3 py-2">Workspace</div>
      {NAV.map((n) => (
        <NavLink key={n.href} {...n} active={n.href === "/" ? path === "/" : path.startsWith(n.href)} />
      ))}
      <div className="text-[11px] tracking-widest uppercase text-gray-400 px-3 pt-5 pb-2">About</div>
      {ABOUT.map((n) => (
        <NavLink key={n.href} {...n} active={path.startsWith(n.href)} />
      ))}
      <div className="mt-auto px-3 pt-8 text-xs leading-relaxed text-gray-400">
        Reads metadata only. Passwords are never stored on the server.
      </div>
    </nav>
  );
}

function NavLink({ href, label, icon, active }: { href: string; label: string; icon: React.ReactNode; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex items-center gap-2.5 min-h-11 px-3 rounded-lg text-sm no-underline",
        active ? "bg-gray-800 text-white font-medium" : "text-gray-300 hover:bg-gray-800/60 hover:text-white"
      )}
    >
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {icon}
      </svg>
      {label}
    </Link>
  );
}
