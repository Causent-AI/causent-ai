import { InfoIcon } from "@/components/ui/icons";

// The honest framing leads every readout: impact is estimated, not proven, and
// the authoritative method is named. The naive method is labelled "descriptive".

export function TrustCaveat() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-[var(--brand-amber)]/40 bg-[var(--brand-amber)]/[0.08] px-3 py-2 text-[12px] leading-relaxed text-[var(--text)]">
      <InfoIcon className="mt-0.5 shrink-0 text-[var(--brand-amber)]" />
      <p>
        <span className="font-semibold">Estimated impact — not proven.</span>{" "}
        Method: <span className="font-medium">OLS Interrupted Time Series</span>{" "}
        (authoritative). A 14-day before/after cross-check is shown as{" "}
        <span className="italic">descriptive</span> only. Confident claims require
        ≥45 daily points on each side of a ship date.
      </p>
    </div>
  );
}
