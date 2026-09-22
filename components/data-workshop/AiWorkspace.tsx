"use client";
import Link from "next/link";
import { useState } from "react";
export function AiWorkspace({
  model,
  estimates,
}: {
  model: string;
  estimates: Array<{
    reportId: string;
    report: string;
    action: string;
    cost: string;
    time: string;
  }>;
}) {
  const [tab, setTab] = useState("harnesses");
  const [inputTokens, setInputTokens] = useState(10000);
  const [outputTokens, setOutputTokens] = useState(2000);
  const [inputRate, setInputRate] = useState("");
  const [outputRate, setOutputRate] = useState("");
  const [runs, setRuns] = useState(1);
  const valid =
    inputRate !== "" &&
    outputRate !== "" &&
    [
      inputTokens,
      outputTokens,
      Number(inputRate),
      Number(outputRate),
      runs,
    ].every((n) => Number.isFinite(n) && n >= 0) &&
    runs > 0;
  const estimate = valid
    ? ((inputTokens * Number(inputRate) + outputTokens * Number(outputRate)) /
        1e6) *
      runs
    : null;
  return (
    <section className="ai-workspace">
      <div className="workspace-heading">
        <h2>AI workspace</h2>
        <nav className="subtabs" aria-label="AI Workspace">
          {["connections", "harnesses", "cost"].map((key) => (
            <button
              type="button"
              key={key}
              aria-pressed={tab === key}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => setTab(key)}
            >
              {key[0].toUpperCase() + key.slice(1)}
            </button>
          ))}
        </nav>
      </div>
      {tab === "connections" && (
        <div className="connection-grid">
          <article className="connection-card">
            <h2>Report AI</h2>
            <p>{model}</p>
            <p>Used when you generate a report or request a rewrite.</p>
            <span className="status-label">
              Configured · availability checked on request
            </span>
          </article>
          <article className="connection-card">
            <h2>Claude</h2>
            <p>Copy an action’s approved context into your Claude workspace.</p>
            <Link href="/actions" className="button mt-4">
              Open actions
            </Link>
            <span className="status-label">Manual handoff</span>
          </article>
          <article className="connection-card">
            <h2>Codex</h2>
            <p>Copy an action’s approved context into your Codex workspace.</p>
            <Link href="/actions" className="button mt-4">
              Open actions
            </Link>
            <span className="status-label">Manual handoff</span>
          </article>
          <article className="connection-card">
            <h2>Local runtime</h2>
            <p>Local execution is not connected to this workspace.</p>
            <span className="status-label">Setup required</span>
          </article>
        </div>
      )}
      {tab === "harnesses" && (
        <>
          <div className="section-heading">
            <h3>Harnesses</h3>
            <span className="connection-state">Manual handoff</span>
          </div>
          <div className="connection-grid">
            {[
              {
                name: "Build",
                glyph: "B",
                description: "Implement an approved action",
                instructions:
                  "Read the approved brief and acceptance criteria. Build the scoped change, run the required checks, review the diff, and return the PR link and validation results.",
              },
              {
                name: "Review",
                glyph: "R",
                description: "Review code and evidence",
                instructions:
                  "Review the change against the approved action, metric, security constraints, and acceptance criteria. Report actionable findings with file references and validation gaps.",
              },
              {
                name: "UX review",
                glyph: "UX",
                description: "Check the complete user flow",
                instructions:
                  "Review desktop and mobile flows against the approved design. Check editing, navigation, keyboard access, empty states, errors, and data clarity. Return concrete recommendations and screenshots.",
              },
            ].map((harness) => (
              <article className="connection-card" key={harness.name}>
                <div className="connection-card-top">
                  <span className="connection-glyph">{harness.glyph}</span>
                  <span className="connection-state">Guide</span>
                </div>
                <h3>{harness.name}</h3>
                <p>{harness.description}</p>
                <code>Claude / Codex · model selected in partner</code>
                <details className="harness-guide">
                  <summary>Instructions</summary>
                  <p>{harness.instructions}</p>
                </details>
                <footer>
                  <span>Cost on request</span>
                  <Link href="/actions">Use in Actions ↗</Link>
                </footer>
              </article>
            ))}
          </div>
          <p className="ai-setup-note">
            Partner connections, saved custom harnesses, and automatic execution
            are not configured.
          </p>
        </>
      )}
      {tab === "cost" && (
        <>
          <div className="connection-card">
            <h2>Estimate a task</h2>
            <p>
              Enter your provider’s rates per million tokens. This estimate
              excludes tool fees, caching discounts, and retries.
            </p>
            <div className="cost-inputs">
              {[
                {
                  label: "Input tokens",
                  value: inputTokens,
                  set: (v: string) => setInputTokens(Number(v)),
                },
                {
                  label: "Output tokens",
                  value: outputTokens,
                  set: (v: string) => setOutputTokens(Number(v)),
                },
                {
                  label: "Input rate ($)",
                  value: inputRate,
                  set: setInputRate,
                },
                {
                  label: "Output rate ($)",
                  value: outputRate,
                  set: setOutputRate,
                },
                {
                  label: "Runs",
                  value: runs,
                  set: (v: string) => setRuns(Number(v)),
                },
              ].map((field) => (
                <label key={field.label}>
                  {field.label}
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={field.value}
                    onChange={(e) => field.set(e.target.value)}
                  />
                </label>
              ))}
            </div>
            <output aria-live="polite" className="cost-result">
              {estimate === null
                ? "Add rates to estimate"
                : `$${estimate.toFixed(4)} estimated`}
            </output>
          </div>
          <section className="mt-8">
            <h2>Action estimates</h2>
            {estimates.length ? (
              <div className="overflow-auto mt-4">
                <table className="cost-table">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Report</th>
                      <th>AI cost estimate</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {estimates.map((estimate, i) => (
                      <tr key={i}>
                        <td>{estimate.action}</td>
                        <td>
                          <Link href={`/reports?report=${estimate.reportId}`}>
                            {estimate.report}
                          </Link>
                        </td>
                        <td>{estimate.cost || "Not estimated"}</td>
                        <td>{estimate.time || "Not estimated"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-3 text-sm text-[var(--text-muted)]">
                Action estimates will appear after you create a report.
              </p>
            )}
            <p className="mt-3 text-xs text-[var(--text-muted)]">
              These are saved planning estimates, not billed usage.
            </p>
          </section>
        </>
      )}
    </section>
  );
}
