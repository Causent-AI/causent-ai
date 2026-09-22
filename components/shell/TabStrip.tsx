"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  DataIcon,
  DecisionIcon,
  ImpactIcon,
  ReportIcon,
} from "@/components/ui/icons";

const TABS = [
  { href: "/data-workshop", label: "Data", icon: DataIcon },
  { href: "/reports", label: "Reports", icon: ReportIcon },
  { href: "/actions", label: "Actions", icon: DecisionIcon },
  { href: "/impact", label: "Impact", icon: ImpactIcon },
  { href: "/graph", label: "Graph", icon: NetworkIcon },
] as const;

function NetworkIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="m6 7 11 3M6 8l4 10m7-6-5 6" />
      <circle cx="5" cy="6" r="3" />
      <circle cx="19" cy="11" r="3" />
      <circle cx="11" cy="20" r="3" />
    </svg>
  );
}

export function TabStrip() {
  const pathname = usePathname();
  return (
    <nav className="project-tabs" aria-label="Project sections">
      {TABS.map(({ href, label, icon: Icon }) => {
        const active =
          pathname === href ||
          (href === "/reports" && pathname.startsWith("/onboarding"));
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            className="project-tab"
          >
            <Icon size={16} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
