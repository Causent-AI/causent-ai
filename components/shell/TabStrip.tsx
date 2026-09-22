"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
const TABS = [
  {
    href: "/data-workshop",
    label: "Data",
    shape: (
      <>
        <ellipse cx="12" cy="5" rx="7" ry="3" />
        <path d="M5 5v7c0 4 14 4 14 0V5M5 12v7c0 4 14 4 14 0v-7" />
      </>
    ),
  },
  {
    href: "/reports",
    label: "Reports",
    shape: <path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" />,
  },
  {
    href: "/actions",
    label: "Actions",
    shape: <path d="m4 6 2 2 4-4M13 6h7M4 13h5M13 13h7M4 20h5M13 20h7" />,
  },
  {
    href: "/impact",
    label: "Impact",
    shape: <path d="M4 3v17h17M7 15l5-6 4 3 5-7" />,
  },
  {
    href: "/graph",
    label: "Graph",
    shape: (
      <>
        <circle cx="5" cy="12" r="3" />
        <circle cx="18" cy="5" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="m8 10 7-4M8 14l7 4" />
      </>
    ),
  },
] as const;

export function TabStrip() {
  const pathname = usePathname();
  return (
    <nav className="project-tabs" aria-label="Project sections">
      {TABS.map(({ href, label, shape }) => {
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
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.65"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {shape}
            </svg>
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
