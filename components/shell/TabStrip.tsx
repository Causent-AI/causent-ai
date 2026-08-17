"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Scope } from "@/lib/types";
import { DataIcon, DecisionIcon, FolderIcon, ImpactIcon, ReportIcon } from "@/components/ui/icons";

const TABS = [
  { href: "/data-workshop", label: "Data", icon: DataIcon },
  { href: "/reports", label: "Reports", icon: ReportIcon },
  { href: "/actions", label: "Actions", icon: DecisionIcon },
  { href: "/impact", label: "Impact", icon: ImpactIcon },
] as const;

export function TabStrip({ scope }: { scope: Scope }) {
  const pathname = usePathname();

  return (
    <div className="grid min-h-14 grid-cols-1 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2 xl:grid-cols-[minmax(220px,1fr)_auto_minmax(220px,1fr)] xl:px-5">
      <div className="flex min-w-0 items-center gap-2 text-[13px]">
        <FolderIcon className="text-[var(--text-subtle)]" />
        <span className="truncate font-medium text-[var(--brand-blue)]">{scope.project}</span>
        <span className="text-[var(--text-subtle)]">/</span>
        <span className="truncate font-semibold text-[var(--text)]">{scope.workspace}</span>
      </div>

      <nav className="scroll-slim flex min-w-0 items-center gap-1 overflow-x-auto sm:justify-center xl:overflow-visible" aria-label="Project sections">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-[13px] transition-colors ${
                active
                  ? "bg-slate-900 font-semibold text-white shadow-sm"
                  : "font-medium text-[var(--text-muted)] hover:bg-slate-100 hover:text-[var(--text)]"
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div className="hidden xl:block" aria-hidden="true" />
    </div>
  );
}
