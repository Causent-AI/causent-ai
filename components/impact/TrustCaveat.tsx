import { InfoIcon } from "@/components/ui/icons";

// The honest framing leads every readout: impact is estimated, not proven, and
// the authoritative method is named. The naive method is labelled "descriptive".

export function TrustCaveat() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-[var(--brand-amber)]/40 bg-[var(--brand-amber)]/[0.08] px-3 py-2 text-[12px] leading-relaxed text-[var(--text)]">
      <InfoIcon className="mt-0.5 shrink-0 text-[var(--brand-amber)]" />
      <p>
        <span className="font-semibold">Estimated, not proven.</span>{" "}
        OLS interrupted time series; the 14-day before/after view is descriptive.
        Confident results require ≥45 daily points on each side of the action.
      </p>
    </div>
  );
}
