"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Sessions", icon: "M" },
  { href: "/registry", label: "Registry", icon: "R" },
  { href: "/contracts", label: "Contracts", icon: "C" },
  { href: "/orchestration", label: "Orchestration", icon: "O" },
  { href: "/economy", label: "Economy", icon: "E" },
  { href: "/marketplace", label: "Marketplace", icon: "X" },
  { href: "/logs", label: "Logs", icon: "L" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="fixed left-0 top-0 flex h-screen w-56 flex-col border-r border-slate-800 bg-slate-900">
      <div className="border-b border-slate-800 px-5 py-5">
        <h1 className="text-lg font-bold tracking-tight text-slate-100">
          <span className="text-indigo-400">Claw</span>dia
        </h1>
        <p className="mt-0.5 text-xs text-slate-500">Agent Dashboard</p>
      </div>

      <div className="mt-4 flex flex-1 flex-col gap-1 px-3">
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-indigo-500/10 text-indigo-400"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold ${
                  active
                    ? "bg-indigo-500/20 text-indigo-400"
                    : "bg-slate-800 text-slate-500"
                }`}
              >
                {link.icon}
              </span>
              {link.label}
            </Link>
          );
        })}
      </div>

      <div className="border-t border-slate-800 px-5 py-4">
        <p className="text-xs text-slate-600">v0.1.0</p>
      </div>
    </nav>
  );
}
