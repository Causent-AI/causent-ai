import type {
  Claim,
  DecisionReportGoldenExample,
  DraftAction,
} from "@/lib/decision-reports/schema";

const BRIEF_SOURCE = "gummy-alpha-founder-brief";

function claim(
  id: string,
  text: string,
  status: Claim["status"],
  sourceChunkIds: string[] = [],
): Claim {
  return { id, text, status, sourceChunkIds };
}

function action(index: number, title: string, summary: string): DraftAction {
  return {
    sourceItemId: `gummy-action-${index}`,
    title,
    summary: [claim(`gummy-action-${index}-summary`, summary, "suggested")],
    owner: null,
  };
}

export const GUMMY_ALPHA_GOLDEN_EXAMPLE: DecisionReportGoldenExample = {
  workspaceName: "Orbit",
  projectName: "Gummy Alpha",
  initialPrompt:
    "Deploy an AI shopping assistant on the Gummy Alpha website. The product mixer already exists, but customers abandon it while combining flavors. They also ask where to find the mixer and commonly choose only one flavor. Mixed-box unit purchases increased 25% quarter over quarter. The assistant should recommend valid combinations, explain how they taste, clarify product rules, and help shoppers complete the mixer. Gummy Alpha offers strawberry, orange, vanilla, chocolate, blueberry, and hazelnut in spheres, squares, stars, and puppy-face shapes. Each gummy may use one or two flavors. Orders are $15 per pound with a one-pound minimum.",
  report: {
    schemaVersion: 1,
    title: "AI guidance for the Gummy Alpha flavor mixer",
    decision: {
      decision: [
        claim(
          "decision-primary",
          "Deploy a contextual AI shopping assistant at the flavor-combination step of the existing Gummy Alpha product mixer.",
          "sourced",
          [BRIEF_SOURCE],
        ),
      ],
      background: [
        claim(
          "decision-background",
          "Gummy Alpha lets customers assemble custom gummy orders from six flavors and four shapes. Gummies may contain one flavor or a maximum of two combined flavors. Orders cost $15 per pound with a one-pound minimum.",
          "sourced",
          [BRIEF_SOURCE],
        ),
      ],
      problem: [
        claim(
          "decision-problem",
          "Customers frequently abandon the mixer while combining flavors. They appear uncertain about which combinations are valid and how those combinations will taste.",
          "sourced",
          [BRIEF_SOURCE],
        ),
      ],
    },
    supportingEvidence: {
      factors: [
        claim(
          "evidence-abandonment",
          "Customers abandon mixer sessions during flavor combination.",
          "sourced",
          [BRIEF_SOURCE],
        ),
        claim(
          "evidence-simple-mixes",
          "Customers commonly select basic one-flavor configurations.",
          "sourced",
          [BRIEF_SOURCE],
        ),
        claim(
          "evidence-mixed-growth",
          "Mixed-box unit purchases increased 25% quarter over quarter.",
          "sourced",
          [BRIEF_SOURCE],
        ),
      ],
      metricMechanism: [
        claim(
          "metric-mechanism",
          "Contextual recommendations and taste explanations should reduce uncertainty at the combination step, increasing the percentage of shoppers who complete it.",
          "inferred",
        ),
      ],
    },
    implementation: {
      actionPlanSummary: [
        claim(
          "action-plan-summary",
          "Introduce contextual assistance at the point of highest mixer abandonment, test it against the current experience, and measure whether it improves completion without adding friction.",
          "suggested",
        ),
      ],
      actions: [
        action(1, "Instrument the flavor-combination funnel", "Capture starts, completions, exits, and the exact step where each session ends."),
        action(2, "Build the contextual assistant", "Ground answers in approved product knowledge and connect valid recommendations to mixer selections."),
        action(3, "Run a controlled experiment", "Compare assisted and unassisted mixer sessions, then decide using completion and accuracy guardrails."),
      ],
      customers: [claim("implementation-customers", "", "missing")],
      stakeholders: [claim("implementation-stakeholders", "", "missing")],
      assetIds: [],
      governance: {
        dataClassification: null,
        allowedDataSources: [claim("governance-data", "", "missing")],
        approvedModelNotes: [claim("governance-model", "", "missing")],
      },
    },
  },
  metricProjection: {
    metricName: "Flavor-combination step completion rate",
    definition:
      "Sessions completing flavor combination ÷ sessions starting flavor combination",
    baselinePct: 40,
    predictedPct: 55,
    baselineLabel: "Illustrative baseline",
    predictionLabel: "Founder prediction",
    evidenceState: "illustrative_assumption",
  },
};
