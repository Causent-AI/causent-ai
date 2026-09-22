"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GA4_METRICS, type Ga4Metric, type Ga4Report, type Ga4Property } from "@/lib/ga4/google";
import { measurementReason } from "@/lib/metrics/measurement";

type Connection = { connection_id: string; property_name: string | null; property_id: string | null; timezone: string | null; status: string; last_sync_at: string | null; error_code: string | null };
type Health = { connection_id: string; metric_id: string; provider_metric: string; row_count: number | null; missing_days: number | null; start_date: string | null; end_date: string | null; reason: string | null };
const button = "rounded-md border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50";
const input = "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm";

export function Ga4Connections({ connections, health, enabled, admin, notice }: { connections: Connection[]; health: Health[]; enabled: boolean; admin: boolean; notice?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(notice === "retry" ? "Google authorization was not completed. Try connecting again." : notice === "connected" ? "Choose a property to import." : "");
  const [selected, setSelected] = useState<Connection | null>(null);
  const [properties, setProperties] = useState<Array<{ id: string; name: string }>>([]);
  const [property, setProperty] = useState("");
  const [metric, setMetric] = useState<Ga4Metric>("sessions");
  const [event, setEvent] = useState("");
  const [direction, setDirection] = useState("higher");
  const [preview, setPreview] = useState<{ property: Ga4Property; report: Ga4Report } | null>(null);

  async function request<T>(payload: Record<string, unknown>): Promise<T> {
    const response = await fetch("/api/ga4", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error === "reauthorize" ? "Reconnect Google Analytics." : result.error === "permission" ? "Access denied. Check your workspace role and Google property access." : "Unable to complete this request. Check the connection and try again.");
    return result;
  }
  async function perform(action: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : "Request failed."); }
    finally { setBusy(false); }
  }
  function connect(connectionId?: string) {
    void perform(async () => {
      const result = await request<{ url: string }>({ action: "start", connectionId });
      const url = new URL(result.url);
      if (url.origin !== "https://accounts.google.com" || url.pathname !== "/o/oauth2/v2/auth") throw new Error("Authorization unavailable.");
      window.location.assign(url.toString());
    });
  }
  function configure(connection: Connection) {
    setSelected(connection); setPreview(null); setProperties([]); setProperty(connection.property_id ?? "");
    void perform(async () => setProperties((await request<{ properties: Array<{ id: string; name: string }> }>({ action: "properties", connectionId: connection.connection_id })).properties));
  }

  return <section aria-labelledby="ga4-heading" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 id="ga4-heading" className="text-sm">Google Analytics</h3>
      {enabled && admin ? <button className={`${button} bg-blue-600 text-white`} disabled={busy} onClick={() => connect()}>Connect</button> : <span className="text-xs text-[var(--text-muted)]">{enabled ? "Managed by workspace admins" : "Setup required"}</span>}
    </div>
    {message ? <p role="status" className="text-sm text-[var(--text-muted)]">{message}</p> : null}
    {!connections.length ? <p className="text-sm text-[var(--text-muted)]">Import daily metrics from your GA4 property.</p> : null}
    {connections.map((connection) => <div key={connection.connection_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] p-3">
      <div className="space-y-1 text-sm"><p>{connection.property_name ?? "Google Analytics"}</p><p className="text-xs text-[var(--text-muted)]">{connection.status}{connection.timezone ? ` · ${connection.timezone}` : ""}{connection.last_sync_at ? ` · Synced ${new Date(connection.last_sync_at).toLocaleDateString()}` : ""}</p>
        {health.filter((metric) => metric.connection_id === connection.connection_id).map((metric) => <p key={metric.metric_id} className="text-xs text-[var(--text-muted)]">
          {metric.provider_metric} · {metric.row_count ?? 0} observations{metric.end_date ? ` through ${metric.end_date}` : ""}{metric.missing_days ? ` · ${metric.missing_days} gaps` : ""}{metric.reason ? ` · ${measurementReason(metric.reason)}` : ""}
        </p>)}
      </div>
      {admin && enabled ? <div className="flex flex-wrap gap-2">
        {["pending", "reauthorize", "disconnected"].includes(connection.status) ? <button className={button} disabled={busy} onClick={() => connect(connection.connection_id)}>Reconnect</button> : <>
          <button className={button} disabled={busy} onClick={() => configure(connection)}>Metrics</button>
          {connection.property_id ? <button className={button} disabled={busy} onClick={() => void perform(async () => { await request({ action: "sync", connectionId: connection.connection_id }); setMessage("Sync queued. Refresh to see new observations."); router.refresh(); })}>Sync</button> : null}
        </>}
        {connection.status !== "disconnected" ? <button className={button} disabled={busy} onClick={() => void perform(async () => { const result = await request<{ providerRevoked: boolean }>({ action: "disconnect", connectionId: connection.connection_id }); setSelected(null); setMessage(result.providerRevoked ? "Disconnected. Stored metric history is retained." : "Disconnected. Remove Causent access in your Google Account to finish revocation."); router.refresh(); })}>Disconnect</button> : null}
      </div> : null}
    </div>)}
    {selected ? <form className="grid gap-3 rounded-lg border border-[var(--border)] p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void perform(async () => setPreview(await request({ action: "preview", connectionId: selected.connection_id, propertyId: property, metric, event: metric === "eventCount" ? event : "" }))); }}>
      <label className="space-y-1 text-xs">Property<select className={input} value={property} required disabled={busy || !!selected.property_id} onChange={(e) => { setProperty(e.target.value); setPreview(null); }}><option value="">Choose</option>{properties.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}</select></label>
      <label className="space-y-1 text-xs">Metric<select className={input} value={metric} disabled={busy} onChange={(e) => { setMetric(e.target.value as Ga4Metric); setPreview(null); }}>{GA4_METRICS.map((m) => <option key={m}>{m}</option>)}</select></label>
      {metric === "eventCount" ? <label className="space-y-1 text-xs">Event (optional)<input className={input} maxLength={80} value={event} disabled={busy} onChange={(e) => { setEvent(e.target.value); setPreview(null); }} /></label> : null}
      <label className="space-y-1 text-xs">Desired direction<select className={input} value={direction} disabled={busy} onChange={(e) => setDirection(e.target.value)}><option value="higher">Higher</option><option value="lower">Lower</option><option value="neutral">Neutral</option></select></label>
      <div className="flex items-end gap-2"><button className={button} disabled={busy || !property}>Preview</button><button type="button" className={button} onClick={() => setSelected(null)}>Close</button></div>
      {preview ? <div className="space-y-3 sm:col-span-2">
        <p className="text-sm">{preview.report.rowCount} daily observations · {preview.report.start}–{preview.report.end} · {preview.property.timezone}</p>
        <p className="text-xs text-[var(--text-muted)]">{preview.report.missingDays} missing days. {Object.values(preview.report.quality).some(Boolean) ? "Google quality restrictions prevent analysis." : "Analysis requires a registered plan and complete measurement history."}</p>
        <div className="max-h-40 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th className="font-normal">Date</th><th className="font-normal">Value</th></tr></thead><tbody>{preview.report.observations.slice(-14).map((o) => <tr key={o.date}><td>{o.date}</td><td>{o.value.toLocaleString()}</td></tr>)}</tbody></table></div>
        <button type="button" className={`${button} bg-blue-600 text-white`} disabled={busy} onClick={() => void perform(async () => {
          await request({ action: "import", connectionId: selected.connection_id, propertyId: property, metrics: [{ metric, event: metric === "eventCount" ? event : "", direction }] });
          setMessage("Import queued. Refresh after sync, then select this metric in Core Metrics."); setSelected(null); router.refresh();
        })}>Import</button>
      </div> : null}
    </form> : null}
  </section>;
}
