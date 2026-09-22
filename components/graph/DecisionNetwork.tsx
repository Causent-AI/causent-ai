"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { NetworkNode } from "@/lib/data/decision-network";
import type { AccessibleWorkspace } from "@/lib/auth/workspace-selection";
import { layoutDecisionNetwork } from "@/lib/data/decision-network-layout";
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
  const drag = useRef<{
    x: number;
    y: number;
    scroll: number;
    top: number;
  } | null>(null);
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
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      setZoom((value) =>
        Math.min(3, Math.max(0.05, value * Math.exp(-event.deltaY * 0.001))),
      );
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [visible.length]);
  const selected = visible.find((node) => node.id === selectedId);
  const { groups, width, height, coordinates } = layoutDecisionNetwork(visible);
  const dateTicks = [...new Set(visible.map((node) => node.date))]
    .sort()
    .filter((_, i, dates) => i % Math.max(1, Math.ceil(dates.length / 6)) === 0)
    .map((date) => ({
      date,
      x: coordinates.get(visible.find((node) => node.date === date)!.id)!.x,
    }));
  const metricName =
    metrics.find((metric) => metric.id === metricId)?.name ?? "Core metric";
  return (
    <div className="network-page">
      <div className="network-heading">
        <h1>Decision Network</h1>
        <div className="network-filters">
          <label>
            <span>Project scope</span>
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
            <span>Period</span>
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
          </label>
          <input
            type="search"
            aria-label="Search decisions"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="network-toolbar">
        <div className="network-metric">
          <span className="metric-orb" aria-hidden="true" />
          <span>Core metric</span>
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
        </div>
        <span className="network-count">
          {visible.length} decisions · {groups.length} projects
        </span>
        <div className="network-zoom">
          <button
            aria-label="Zoom out"
            onClick={() => setZoom((z) => Math.max(0.05, z / 1.25))}
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
            onClick={() => setZoom((z) => Math.min(3, z * 1.25))}
          >
            ＋
          </button>
          <button
            aria-label="Fit network"
            onClick={() => {
              const el = viewport.current;
              if (el) {
                setZoom(
                  Math.min(1, el.clientWidth / width, el.clientHeight / height),
                );
                el.scrollTo({ left: 0, top: 0 });
              }
            }}
          >
            Fit
          </button>
        </div>
      </div>
      <div className="network-stage">
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
            aria-label="Decision timeline. Drag to pan, scroll to zoom. Keyboard arrow keys pan; zoom controls are above."
            onPointerDown={(e) => {
              if ((e.target as Element).closest("[role=button]")) return;
              drag.current = {
                x: e.clientX,
                y: e.clientY,
                top: e.currentTarget.scrollTop,
                scroll: e.currentTarget.scrollLeft,
              };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (drag.current) {
                e.currentTarget.scrollLeft =
                  drag.current.scroll - (e.clientX - drag.current.x);
                e.currentTarget.scrollTop =
                  drag.current.top - (e.clientY - drag.current.y);
              }
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
              {dateTicks.map(({ date, x }) => (
                <g key={date}>
                  <line
                    x1={x}
                    x2={x}
                    y1="55"
                    y2={height - 45}
                    stroke="#536174"
                    opacity=".18"
                    strokeDasharray="3 6"
                  />
                  <text
                    x={x}
                    y="32"
                    textAnchor="middle"
                    fill="#7f91a7"
                    fontSize="12"
                  >
                    {date}
                  </text>
                </g>
              ))}
              <g aria-label={`Core metric: ${metricName}`}>
                <circle
                  cx="92"
                  cy={height / 2}
                  r="30"
                  fill="#65d1b5"
                  opacity=".08"
                />
                <circle cx="92" cy={height / 2} r="13" fill="#80d5d3" />
                <text
                  x="92"
                  y={height / 2 + 45}
                  fill="#c5d2e0"
                  textAnchor="middle"
                  fontSize="13"
                >
                  {metricName.slice(0, 25)}
                </text>
              </g>
              {groups.map((group) => {
                const node = visible.find(
                  (n) => n.workspaceId === group.workspaceId,
                )!;
                const y = group.y;
                return (
                  <g key={group.workspaceId}>
                    <line
                      x1="310"
                      y1={y}
                      x2={width - 50}
                      y2={y}
                      stroke="#5b78954d"
                      strokeDasharray="3 7"
                    />
                    <path
                      d={`M108,${height / 2} C200,${height / 2} 200,${y} 273,${y}`}
                      fill="none"
                      stroke="#6faaa459"
                    />
                    <path
                      d={`M290,${y - 17} l17,17 -17,17 -17,-17 Z`}
                      fill="#26323e"
                      stroke="#8ca0b5"
                    />
                    <text
                      x="290"
                      y={y + 42}
                      fill="#e1edfc"
                      textAnchor="middle"
                      fontSize="12"
                    >
                      {node.project.slice(0, 20)}
                    </text>
                    <text
                      x="290"
                      y={y + 58}
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
                      d={`M307,${groups.find((g) => g.workspaceId === node.workspaceId)!.y} Q${point.x - 60},${groups.find((g) => g.workspaceId === node.workspaceId)!.y} ${point.x},${point.y}`}
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
                    <rect
                      x={point.x - 112}
                      y={point.y - 25}
                      width="224"
                      height="90"
                      fill="transparent"
                      pointerEvents="all"
                    />
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={selected ? 29 : 25}
                      fill={node.status === "Current" ? "#80d5d3" : "#5a99f5"}
                      opacity=".18"
                    />
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r="11"
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
      <footer className="network-caption">
        <span>
          <i className="legend-decision" />
          Decision <i className="legend-current" />
          Current <i className="legend-project" />
          Project
        </span>
        <span>Drag to pan · Scroll to zoom</span>
      </footer>
      <p className="network-semantics">
        Links show project membership and report versions. Overlapping impacts
        are not added together.
      </p>
    </div>
  );
}
