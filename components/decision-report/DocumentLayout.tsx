"use client";

import Link from "next/link";
import { createContext, useContext, useState, type ReactNode } from "react";
import { ReportCanvasEditor } from "./rich-text/ReportCanvasEditor";
import {
  portableRichTextFromPlainText,
  type ReportDocumentLayout,
  type ReportSectionKey,
} from "@/lib/decision-reports/schema";
import { useWorkspaceMetrics } from "@/components/shell/WorkspaceMetrics";

type Layout = Pick<
  ReportDocumentLayout,
  "sectionTitles" | "sections" | "charts"
>;
const defaults: Record<ReportSectionKey, string> = {
  overview: "Overview",
  decision: "Decision",
  implementation: "Implementation Plan",
  measurement: "Measurement",
};
const Context = createContext<{
  layout: Layout;
  readOnly: boolean;
  update: (layout: Layout) => void;
} | null>(null);
export function DocumentLayoutProvider({
  layout,
  readOnly,
  update,
  children,
}: {
  layout: Layout;
  readOnly: boolean;
  update: (layout: Layout) => void;
  children: ReactNode;
}) {
  return (
    <Context.Provider value={{ layout, readOnly, update }}>
      {children}
    </Context.Provider>
  );
}
export function DocumentSectionTitle({
  section,
}: {
  section: ReportSectionKey;
}) {
  const context = useContext(Context);
  const title = context?.layout.sectionTitles?.[section] ?? defaults[section];
  if (!context || context.readOnly) return <h2>{title}</h2>;
  return (
    <input
      aria-label={`Rename ${defaults[section]} section`}
      className="section-title"
      value={title}
      maxLength={100}
      onChange={(event) => {
        if (event.target.value.trim())
          context.update({
            ...context.layout,
            sectionTitles: {
              ...context.layout.sectionTitles,
              [section]: event.target.value,
            },
          });
      }}
    />
  );
}
export function DocumentOutline() {
  const context = useContext(Context);
  return (
    <aside className="report-outline">
      <nav aria-label="Report sections">
        {Object.entries(defaults).map(([key, title]) => (
          <a key={key} href={`#report-${key}`}>
            {context?.layout.sectionTitles?.[key as ReportSectionKey] ?? title}
          </a>
        ))}
        {context?.layout.sections?.map((section) => (
          <a key={section.id} href={`#note-${section.id}`}>
            {section.title}
          </a>
        ))}
      </nav>
      <div className="report-library">
        <Link href="/reports?library=1">Report library</Link>
      </div>
    </aside>
  );
}
export function DocumentNotes() {
  const context = useContext(Context);
  if (!context) return null;
  const { layout, update, readOnly } = context;
  const sections = layout.sections ?? [];
  return (
    <div className="document-notes">
      {sections.map((section) => (
        <section id={`note-${section.id}`} key={section.id}>
          <div className="flex items-center gap-3">
            {readOnly ? (
              <h2>{section.title}</h2>
            ) : (
              <input
                aria-label="Section name"
                className="section-title"
                value={section.title}
                maxLength={100}
                onChange={(e) => {
                  if (e.target.value.trim())
                    update({
                      ...layout,
                      sections: sections.map((s) =>
                        s.id === section.id
                          ? { ...s, title: e.target.value }
                          : s,
                      ),
                    });
                }}
              />
            )}
            {!readOnly && (
              <button
                type="button"
                aria-label={`Remove ${section.title} section`}
                className="text-sm text-[var(--text-muted)]"
                onClick={() =>
                  update({
                    ...layout,
                    sections: sections.filter((s) => s.id !== section.id),
                  })
                }
              >
                ×
              </button>
            )}
          </div>
          <ReportCanvasEditor
            canvasId={`note-${section.id}-editor`}
            label={section.title}
            readOnly={readOnly}
            sections={[
              {
                claimId: section.id,
                label: "Notes",
                document: section.document,
              },
            ]}
            onChange={(changes) =>
              update({
                ...layout,
                sections: sections.map((s) => ({
                  ...s,
                  document:
                    changes.find((change) => change.claimId === s.id)
                      ?.document ?? s.document,
                })),
              })
            }
          />
        </section>
      ))}
      {!readOnly && sections.length < 8 && (
        <button
          className="button"
          type="button"
          onClick={() =>
            update({
              ...layout,
              sections: [
                ...sections,
                {
                  id: crypto.randomUUID(),
                  title: "New section",
                  document: portableRichTextFromPlainText(""),
                },
              ],
            })
          }
        >
          ＋ Section
        </button>
      )}
    </div>
  );
}
export function DocumentCharts() {
  const context = useContext(Context);
  const metrics = useWorkspaceMetrics();
  const [metricId, setMetricId] = useState(metrics[0]?.id ?? "");
  const [type, setType] = useState<"line" | "bar">("line");
  if (!context) return null;
  const { layout, update, readOnly } = context;
  const charts = layout.charts ?? [];
  return (
    <div className="document-charts">
      {!readOnly && (
        <details className="chart-picker">
          <summary className="button">＋ Chart</summary>
          <div className="flex flex-wrap items-end gap-3 py-3">
            <label className="text-sm">
              Metric
              <select
                aria-label="Chart metric"
                className="block rounded border p-2"
                value={metricId}
                onChange={(e) => setMetricId(e.target.value)}
              >
                {metrics.map((metric) => (
                  <option key={metric.id} value={metric.id}>
                    {metric.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Style
              <select
                aria-label="Chart style"
                className="block rounded border p-2"
                value={type}
                onChange={(e) => setType(e.target.value as "line" | "bar")}
              >
                <option value="line">Line</option>
                <option value="bar">Bar</option>
              </select>
            </label>
            <button
              type="button"
              className="button"
              disabled={!metricId || charts.length >= 4}
              onClick={() =>
                update({
                  ...layout,
                  charts: [
                    ...charts,
                    { id: crypto.randomUUID(), metricId, type },
                  ],
                })
              }
            >
              Generate
            </button>
            {metrics.length === 0 && (
              <Link
                href="/data-workshop?add=metric"
                className="text-sm underline"
              >
                Add metric data
              </Link>
            )}
          </div>
        </details>
      )}
      {charts.map((chart) => {
        const metric = metrics.find((metric) => metric.id === chart.metricId);
        const series =
          metric?.series.filter((point) => Number.isFinite(point.value)) ?? [];
        const low = Math.min(0, ...series.map((p) => p.value));
        const high = Math.max(1, ...series.map((p) => p.value));
        const y = (v: number) => 155 - ((v - low) / (high - low)) * 130;
        const x = (i: number) =>
          40 + (i / Math.max(1, series.length - 1)) * 600;
        return (
          <figure key={chart.id} className="metric-chart">
            <figcaption className="flex justify-between gap-3">
              <span>{metric?.name ?? "Metric unavailable"}</span>
              {!readOnly && (
                <button
                  type="button"
                  aria-label="Remove chart"
                  onClick={() =>
                    update({
                      ...layout,
                      charts: charts.filter((c) => c.id !== chart.id),
                    })
                  }
                >
                  ×
                </button>
              )}
            </figcaption>
            {series.length ? (
              <>
                <svg
                  viewBox="0 0 690 190"
                  role="img"
                  aria-label={`${metric?.name} ${chart.type} chart, ${series.length} observations`}
                >
                  <text x="0" y="26" fontSize="11" fill="#68717b">
                    {high.toLocaleString()}
                  </text>
                  <text x="0" y="155" fontSize="11" fill="#68717b">
                    {low.toLocaleString()}
                  </text>
                  <line x1="40" x2="655" y1={y(0)} y2={y(0)} stroke="#dfe4e9" />
                  {chart.type === "line" ? (
                    <polyline
                      points={series
                        .map((p, i) => `${x(i)},${y(p.value)}`)
                        .join(" ")}
                      fill="none"
                      stroke="#00aaa7"
                      strokeWidth="2.5"
                    />
                  ) : (
                    series.map((p, i) => (
                      <rect
                        key={p.date}
                        x={x(i)}
                        y={Math.min(y(p.value), y(0))}
                        width={Math.max(1, 500 / series.length)}
                        height={Math.max(1, Math.abs(y(0) - y(p.value)))}
                        fill="#377ded"
                      />
                    ))
                  )}
                  <text x="40" y="181" fontSize="11" fill="#68717b">
                    {series[0]?.date}
                  </text>
                  <text
                    x="640"
                    y="181"
                    textAnchor="end"
                    fontSize="11"
                    fill="#68717b"
                  >
                    {series.at(-1)?.date}
                  </text>
                </svg>
                <small>
                  Observed data ·{" "}
                  {metric?.format === "percent"
                    ? metric.percentScale === "ratio"
                      ? "ratio"
                      : metric.percentScale === "points"
                        ? "percentage points"
                        : "percent scale unspecified"
                    : metric?.format}
                  . Not an impact estimate.
                </small>
              </>
            ) : (
              <p>No observations available.</p>
            )}
          </figure>
        );
      })}
    </div>
  );
}
