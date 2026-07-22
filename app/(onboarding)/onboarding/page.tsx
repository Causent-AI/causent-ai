import type { Metadata } from "next";
import { DecisionReportOnboarding } from "@/components/decision-report/DecisionReportOnboarding";

// Slice 1 of the AI-assisted onboarding: one deterministic brief generates an
// editable, three-section Decision Report. Model calls and persistence remain
// deliberately outside this route until the report experience is validated.

export const metadata: Metadata = {
  title: "Causent — Build a Decision Report",
};

// The funnel writes on every visit path; never prerender it at build time.
export const dynamic = "force-dynamic";

export default function OnboardingPage() {
  return <DecisionReportOnboarding />;
}
