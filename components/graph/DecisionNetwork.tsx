"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { NetworkNode } from "@/lib/data/decision-network";
import type { AccessibleWorkspace } from "@/lib/auth/workspace-selection";
export function DecisionNetwork({
  nodes,
  metrics,
  workspaces,
  scope,
  activeWorkspaceId,
}: {
  nodes: NetworkNode[];
  metrics: Array<{ id: string; name: string; workspace: string }>;
  workspaces: AccessibleWorkspace[];
  scope: string;
  activeWorkspaceId: string;
}) {
  const router = useRouter();
  const [metricId, setMetricId] = useState(metrics[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; scroll: number } | null>(null);
  const periods = useMemo(
    () =>
      [
        ...new Set(
          nodes.flatMap((node) => {
            const year = node.date.slice(0, 4);
            return [
              year,
              `${year}-Q${Math.ceil(Number(node.date.slice(5, 7)) / 3)}`,
            ];
          }),
        ),
      ]
        .sort()
        .reverse(),
    [nodes],
  );
  const visible = nodes.filter(
    (node) =>
      node.metricIds.includes(metricId) &&
      (period === "all" ||
        (period.includes("Q")
          ? `${node.date.slice(0, 4)}-Q${Math.ceil(Number(node.date.slice(5, 7)) / 3)}` ===
            period
          : node.date.startsWith(period))) &&
      `${node.title} ${node.project} ${node.workspace}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const selected = visible.find((node) => node.id === selectedId);
  const groups = [...new Set(visible.map((node) => node.workspaceId))];
  const start = Math.min(...visible.map((node) => Date.parse(node.date)));
  const end = Math.max(...visible.map((node) => Date.parse(node.date)));
  const width = Math.max(1000, visible.length * 155);
  const height = Math.max(420, groups.length * 155 + 120);
  const coordinates = new Map(
    visible.map((node, i) => [
      node.id,
      {
        x:
          260 +
          (end > start
            ? (Date.parse(node.date) - start) / (end - start)
            : i / Math.max(1, visible.length - 1)) *
            (width - 380),
        y: 130 + groups.indexOf(node.workspaceId) * 155 + (i % 2) * 45,
      },
    ]),
  );
  return (
    <div className="network-page">
      <div className="network-heading">
        <h1>Decision Network</h1>
        <div className="network-filters">
          <label>
            <span className="sr-only">Project scope</span>
            <select
              aria-label="Project scope"
              value={scope}
              onChange={(e) =>
                router.push(
                  `/graph?scope=${encodeURIComponent(e.target.value)}`,
                )
              }
            >
              {workspaces.length <= 20 && (
                <option value="all">All projects</option>
              )}
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.project} / {w.workspace}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Core metric</span>
            <select
              aria-label="Core metric"
              value={metricId}
              onChange={(e) => {
                setMetricId(e.target.value);
                setSelectedId(null);
              }}
            >
              {metrics.length === 0 && (
                <option value="">No core metrics</option>
              )}
              {metrics.map((m) => (
                <option value={m.id} key={m.id}>
                  {scope === "all" ? `${m.workspace} · ` : ""}
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <select
            aria-label="Period"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            <option value="all">All time</option>
            {periods.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <input
            type="search"
            aria-label="Search decisions"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="network-stage">
        <div className="network-zoom">
          <button
            aria-label="Zoom out"
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
          >
            −
          </button>
          <button
            aria-label="Reset zoom"
            onClick={() => {
              setZoom(1);
              viewport.current?.scrollTo({ left: 0, top: 0 });
            }}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            aria-label="Zoom in"
            onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
          >
            ＋
          </button>
        </div>
        {visible.length === 0 ? (
          <div className="network-empty">
            <h2>
              {metrics.length ? "No linked decisions" : "Add a core metric"}
            </h2>
            <p>
              {metrics.length
                ? "Choose another metric or period, or link a metric in a report."
                : "Select a core metric in Data Workshop to explore its decisions."}
            </p>
            <Link href={metrics.length ? "/reports" : "/data-workshop"}>
              Open {metrics.length ? "Reports" : "Data Workshop"} →
            </Link>
          </div>
        ) : (
          <div
            className="network-viewport"
            ref={viewport}
            tabIndex={0}
            aria-label="Decision timeline. Scroll to pan, use zoom controls to scale."
            onPointerDown={(e) => {
              if ((e.target as Element).closest("[role=button]")) return;
              drag.current = {
                x: e.clientX,
                scroll: e.currentTarget.scrollLeft,
              };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (drag.current)
                e.currentTarget.scrollLeft =
                  drag.current.scroll - (e.clientX - drag.current.x);
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
          >
            <svg
              width={width * zoom}
              height={height * zoom}
              viewBox={`0 0 ${width} ${height}`}
              role="group"
              aria-label="Project and decision network"
            >
              <defs>
                <pattern
                  id="network-stars"
                  width="71"
                  height="59"
                  patternUnits="userSpaceOnUse"
                >
                  <circle cx="12" cy="31" r=".7" fill="#ffffff" opacity=".22" />
                </pattern>
              </defs>
              <rect width={width} height={height} fill="url(#network-stars)" />
              {groups.map((group) => {
                const node = visible.find((n) => n.workspaceId === group)!;
                const y = 145 + groups.indexOf(group) * 155;
                return (
                  <g key={group}>
                    <line
                      x1="120"
                      y1={y}
                      x2={width - 50}
                      y2={y}
                      stroke="#5b78954d"
                      strokeDasharray="3 7"
                    />
                    <rect
                      x="35"
                      y={y - 24}
                      width="140"
                      height="48"
                      rx="10"
                      fill="#28384a"
                      stroke="#649ae7"
                    />
                    <text
                      x="105"
                      y={y - 3}
                      fill="#e1edfc"
                      textAnchor="middle"
                      fontSize="12"
                    >
                      {node.project.slice(0, 20)}
                    </text>
                    <text
                      x="105"
                      y={y + 13}
                      fill="#9caebf"
                      textAnchor="middle"
                      fontSize="10"
                    >
                      {node.workspace.slice(0, 23)}
                    </text>
                  </g>
                );
              })}
              {visible.map((node) => {
                const point = coordinates.get(node.id)!;
                const previous = node.predecessorId
                  ? coordinates.get(node.predecessorId)
                  : null;
                return (
                  <g key={`edge-${node.id}`}>
                    <path
                      d={`M175,${145 + groups.indexOf(node.workspaceId) * 155} Q${point.x - 60},${145 + groups.indexOf(node.workspaceId) * 155} ${point.x},${point.y}`}
                      fill="none"
                      stroke="#71aaa844"
                    />
                    {previous && (
                      <line
                        x1={previous.x}
                        y1={previous.y}
                        x2={point.x}
                        y2={point.y}
                        stroke="#80d5d3"
                        strokeWidth="2"
                      />
                    )}
                  </g>
                );
              })}
              {visible.map((node) => {
                const point = coordinates.get(node.id)!;
                const selected = node.id === selectedId;
                return (
                  <g
                    key={node.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.title}, ${node.status}, ${node.date}`}
                    aria-pressed={selected}
                    className="network-node"
                    onClick={() => setSelectedId(node.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(node.id);
                      }
                    }}
                  >
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={selected ? 22 : 16}
                      fill={node.status === "Current" ? "#80d5d3" : "#5a99f5"}
                      opacity=".18"
                    />
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r="9"
                      fill={node.status === "Current" ? "#80d5d3" : "#5a99f5"}
                      stroke={selected ? "white" : "none"}
                      strokeWidth="2"
                    />
                    <text
                      x={point.x}
                      y={point.y + 38}
                      textAnchor="middle"
                      fill="#e6eef8"
                      fontSize="12"
                    >
                      {node.title.length > 28
                        ? node.title.slice(0, 26) + "…"
                        : node.title}
                    </text>
                    <text
                      x={point.x}
                      y={point.y + 55}
                      textAnchor="middle"
                      fill="#8896a9"
                      fontSize="10"
                    >
                      {node.date}
                    </text>
                  </g>
                );
              })}
              <line
                x1="235"
                y1={height - 45}
                x2={width - 35}
                y2={height - 45}
                stroke="#607185"
              />
              <text x="235" y={height - 23} fontSize="11" fill="#94a3b8">
                Earlier
              </text>
              <text
                x={width - 35}
                y={height - 23}
                textAnchor="end"
                fontSize="11"
                fill="#94a3b8"
              >
                Later →
              </text>
            </svg>
          </div>
        )}
        {selected && (
          <aside className="network-detail" aria-label="Decision summary">
            <button
              aria-label="Close decision summary"
              onClick={() => setSelectedId(null)}
              className="float-right"
            >
              ×
            </button>
            <small>
              {selected.status} · {selected.dateLabel} {selected.date}
            </small>
            <h2>{selected.title}</h2>
            <p>{selected.summary || "No summary supplied."}</p>
            <h3>Impact</h3>
            {selected.impacts.filter((impact) => impact.metricId === metricId)
              .length ? (
              selected.impacts
                .filter((impact) => impact.metricId === metricId)
                .map((impact, i) => (
                  <p key={i}>
                    {impact.label}
                    <small className="block">{impact.detail}</small>
                  </p>
                ))
            ) : (
              <p>No measured impact yet.</p>
            )}
            {selected.workspaceId === activeWorkspaceId ? (
              <Link
                href={
                  selected.reportId
                    ? `/reports?report=${selected.reportId}`
                    : `/actions?selected=${selected.id}`
                }
              >
                Open {selected.reportId ? "report" : "decision"} →
              </Link>
            ) : (
              <p className="text-xs">
                Switch to {selected.workspace} in the project menu to open this
                report.
              </p>
            )}
          </aside>
        )}
      </div>
      <p className="network-caption">
        Lines show project membership and report versions. Impact stays per
        decision; overlapping effects are not added together.
      </p>
    </div>
  );
}
