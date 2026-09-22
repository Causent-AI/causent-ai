"use client";
import { useState, type ReactNode } from "react";
export function WorkshopTabs({
  metrics,
  connections,
  ai,
  initialTab = "metrics",
}: {
  metrics: ReactNode;
  connections: ReactNode;
  ai: ReactNode;
  initialTab?: string;
}) {
  const [tab, setTab] = useState(initialTab);
  return (
    <div className="workspace-page workshop-page" data-workshop-tab={tab}>
      <header className="workspace-heading">
        <h1>Data Workshop</h1>
        <nav className="subtabs" aria-label="Data Workshop">
          {["metrics", "connections", "ai"].map((key) => (
            <button
              type="button"
              key={key}
              aria-pressed={tab === key}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => setTab(key)}
            >
              {key === "ai" ? "AI" : key[0].toUpperCase() + key.slice(1)}
            </button>
          ))}
        </nav>
      </header>
      <div hidden={tab !== "metrics"}>{metrics}</div>
      <div hidden={tab !== "connections"}>{connections}</div>
      <div hidden={tab !== "ai"}>{ai}</div>
    </div>
  );
}
