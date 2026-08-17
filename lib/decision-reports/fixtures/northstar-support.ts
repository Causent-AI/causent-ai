import type {
  Claim,
  DecisionReportGoldenExample,
  DraftAction,
} from "@/lib/decision-reports/schema";

const BRIEF_SOURCE = "northstar-support-founder-brief";
const INITIAL_PROMPT =
  "Launch an in-product support assistant for Northstar's workspace setup flow. New self-serve customers open repeated tickets about inviting teammates, configuring permissions, and connecting their first data source. Setup-related tickets represent 31% of first-week support volume, median time to first connected source is 4.2 days, and first-week setup completion is currently 40%. The approved success target is 55% first-week setup completion. Maya Chen, Analytics Lead, will instrument setup starts, milestones, completions, and support handoffs. Jonah Patel, Support Lead, will curate the approved setup knowledge and review escalation rules. Priya Rao, Product Engineering Lead, will build and stage the assistant. The assistant must answer only from approved setup documentation, link users to the exact settings page, and hand uncertain requests to support. Start with new self-serve accounts. Elena Brooks, Security Lead, and Jonah must approve the knowledge sources before launch. Treat setup documentation as organization data and never expose customer workspace content to the assistant.";
const INITIAL_PROMPT_SHA256 =
  "c0324b146cf989812ce34b33e4e7b2eeb40d4735ef36b110b1237156b12fdc47";

function claim(
  id: string,
  text: string,
  status: Claim["status"],
  sourceChunkIds: string[] = [],
): Claim {
  return { id, text, status, sourceChunkIds };
}

function action(input: {
  id: string;
  title: string;
  summary: string;
  owner: string;
  priority: 1 | 2 | 3;
  tags: string[];
  skills: string[];
  estimatedTime: string;
  estimatedCost: string;
}): DraftAction {
  return {
    sourceItemId: input.id,
    title: input.title,
    summary: [
      claim(`${input.id}-summary`, input.summary, "sourced", [BRIEF_SOURCE]),
    ],
    owner: claim(`${input.id}-owner`, input.owner, "sourced", [BRIEF_SOURCE]),
    priority: input.priority,
    tags: input.tags,
    skills: input.skills,
    estimatedTime: input.estimatedTime,
    estimatedCost: input.estimatedCost,
  };
}

const ACTION_INSTRUMENT = "northstar-action-instrument";
const ACTION_KNOWLEDGE = "northstar-action-knowledge";
const ACTION_ASSISTANT = "northstar-action-assistant";

export const NORTHSTAR_SUPPORT_GOLDEN_EXAMPLE: DecisionReportGoldenExample = {
  workspaceName: "Northstar",
  projectName: "Support Operations",
  initialPrompt: INITIAL_PROMPT,
  report: {
    schemaVersion: 2,
    title: "Northstar setup assistant rollout",
    activationDraft: {
      confirmedMetricId: null,
      selectedActionSourceItemIds: [
        ACTION_INSTRUMENT,
        ACTION_KNOWLEDGE,
        ACTION_ASSISTANT,
      ],
      primaryLeverActionSourceItemId: ACTION_ASSISTANT,
      prediction: {
        direction: "POSITIVE",
        magnitudePctMean: 37.5,
        resolutionDate: null,
      },
    },
    sourceSummaries: [
      {
        sourceId: BRIEF_SOURCE,
        kind: "brief",
        label: "Project brief",
        locator: null,
        finalOrigin: null,
        pageCount: null,
        retrievedAt: "2026-08-10T00:00:00.000Z",
        contentSha256: INITIAL_PROMPT_SHA256,
        chunks: [
          {
            chunkId: BRIEF_SOURCE,
            locator: null,
            contentSha256: INITIAL_PROMPT_SHA256,
            text: INITIAL_PROMPT,
          },
        ],
      },
    ],
    decision: {
      decision: [
        claim(
          "northstar-decision",
          "Launch an in-product support assistant in Northstar's workspace setup flow for new self-serve accounts.",
          "sourced",
          [BRIEF_SOURCE],
        ),
      ],
      background: [
        claim(
          "northstar-background",
          "New customers repeatedly need help inviting teammates, configuring permissions, and connecting their first data source.",
          "sourced",
          [BRIEF_SOURCE],
        ),
      ],
      problem: [
        claim(
          "northstar-problem",
          "Setup-related tickets make up 31% of first-week support volume, median time to first connected source is 4.2 days, and only 40% of new self-serve accounts complete setup in their first week.",
          "sourced",
          [BRIEF_SOURCE],
        ),
      ],
    },
    supportingEvidence: {
      factors: [
        claim(
          "northstar-evidence-ticket-share",
          "Setup-related tickets represent 31% of first-week support volume.",
          "sourced",
          [BRIEF_SOURCE],
        ),
        claim(
          "northstar-evidence-time",
          "Median time to first connected data source is 4.2 days.",
          "sourced",
          [BRIEF_SOURCE],
        ),
        claim(
          "northstar-evidence-completion",
          "First-week setup completion is 40%, against an approved target of 55%.",
          "sourced",
          [BRIEF_SOURCE],
        ),
      ],
      metricMechanism: [
        claim(
          "northstar-metric-mechanism",
          "Approved, contextual setup guidance should help more new accounts complete required milestones during their first week.",
          "inferred",
        ),
      ],
    },
    implementation: {
      actionPlanSummary: [
        claim(
          "northstar-plan",
          "Instrument the setup journey, approve a bounded knowledge base and escalation path, then stage the assistant for new self-serve accounts before measuring first-week completion.",
          "suggested",
        ),
      ],
      actions: [
        action({
          id: ACTION_INSTRUMENT,
          title: "Instrument the setup journey",
          summary:
            "Maya Chen will instrument setup starts, milestones, completions, and support handoffs so the rollout has a trustworthy baseline and daily outcome series.",
          owner: "Maya Chen · Analytics Lead",
          priority: 3,
          tags: ["Measurement", "Setup"],
          skills: ["Analytics engineering", "Product analytics"],
          estimatedTime: "3–5 days",
          estimatedCost: "Internal team",
        }),
        action({
          id: ACTION_KNOWLEDGE,
          title: "Curate and approve setup knowledge",
          summary:
            "Jonah Patel will curate approved setup documentation and escalation rules, with Elena Brooks reviewing the knowledge sources before launch.",
          owner: "Jonah Patel · Support Lead",
          priority: 3,
          tags: ["Support", "Governance"],
          skills: ["Knowledge management", "Security review"],
          estimatedTime: "1 week",
          estimatedCost: "Internal team",
        }),
        action({
          id: ACTION_ASSISTANT,
          title: "Build and stage the setup assistant",
          summary:
            "Priya Rao will build and stage an in-product assistant that cites approved guidance, links to the exact settings page, and hands uncertain requests to support.",
          owner: "Priya Rao · Product Engineering Lead",
          priority: 3,
          tags: ["Product", "AI", "Experiment"],
          skills: ["Product engineering", "AI engineering"],
          estimatedTime: "3 weeks",
          estimatedCost: "$20K–$35K",
        }),
      ],
      customers: [
        claim(
          "northstar-customers",
          "New Northstar self-serve accounts in their first week of workspace setup.",
          "sourced",
          [BRIEF_SOURCE],
        ),
      ],
      stakeholders: [
        claim(
          "northstar-stakeholders",
          "Maya Chen (Analytics), Jonah Patel (Support), Priya Rao (Product Engineering), and Elena Brooks (Security).",
          "sourced",
          [BRIEF_SOURCE],
        ),
      ],
      assetIds: [],
      governance: {
        dataClassification: "organization",
        allowedDataSources: [
          claim(
            "northstar-governance-sources",
            "Use only setup documentation approved by the Support and Security leads; do not expose customer workspace content.",
            "sourced",
            [BRIEF_SOURCE],
          ),
        ],
        approvedModelNotes: [
          claim(
            "northstar-governance-model",
            "The assistant must link to the exact settings page and hand uncertain requests to support instead of guessing.",
            "sourced",
            [BRIEF_SOURCE],
          ),
        ],
      },
    },
  },
  metricProjection: {
    metricName: "First-week Setup Completion",
    definition:
      "New self-serve accounts completing workspace setup within seven days ÷ new self-serve accounts starting setup",
    baselinePct: 40,
    predictedPct: 55,
    baselineLabel: "Prompt-supplied baseline",
    predictionLabel: "Approved target",
    evidenceState: "prompt_supplied",
  },
};
