"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  removeDecisionReportImageAction,
  uploadDecisionReportImageAction,
} from "@/app/(onboarding)/onboarding/decision-report-asset-actions";
import {
  saveDecisionReportAction,
  type SaveDecisionReportActionResult,
} from "@/app/(onboarding)/onboarding/decision-report-persistence-actions";
import { DecisionSection } from "@/components/decision-report/DecisionSection";
import {
  ImplementationSection,
  type ActionExecutionPatch,
} from "@/components/decision-report/ImplementationSection";
import { ReportActivationPanel } from "@/components/decision-report/ReportActivationPanel";
import { ReportCompletionPanel } from "@/components/decision-report/ReportCompletionPanel";
import { ReportCoreMetricsSection } from "@/components/decision-report/ReportCoreMetricsSection";
import { SupportingEvidenceSection } from "@/components/decision-report/SupportingEvidenceSection";
import type { ReportAssetView } from "@/lib/decision-reports/assets";
import {
  applyReportEditCommand,
  createGapAnswerCommand,
  scanDecisionReportGaps,
  type DecisionReportGap,
  type ReportEditCommandV1,
} from "@/lib/decision-reports/editing";
import type { ReportActivationMetric } from "@/lib/decision-reports/materialization";
import type {
  DecisionReportActivationPointer,
  DecisionReportPersistenceStatus,
} from "@/lib/decision-reports/persistence";
import {
  cloneDecisionReport,
  emptyDecisionReportActivationDraft,
  type DecisionReportActivationDraft,
  type DecisionReportV1,
  type MetricProjection,
} from "@/lib/decision-reports/schema";

type ReportPersistenceState = {
  reportId: string;
  revisionId: string;
  status: DecisionReportPersistenceStatus;
  savedAt: string;
  activation: DecisionReportActivationPointer | null;
};

type SaveStatus = "idle" | "waiting" | "saving" | "saved" | "error" | "conflict";

type PendingSave = {
  report: DecisionReportV1;
  snapshot: string;
  missingFieldCount: number;
};

const AUTOSAVE_DELAY_MS = 750;

export function DecisionReportEditor({
  initialReport,
  projection,
  workspaceName,
  projectName,
  generationMeta,
  initialPersistence,
  initialAsset,
  activationMetrics,
  sourceReceiptId,
  telemetrySessionKey,
  telemetryStartedAtMs,
  activationDateBounds,
  onStartOver,
}: {
  initialReport: DecisionReportV1;
  projection: MetricProjection;
  workspaceName: string;
  projectName: string;
  generationMeta?: {
    mode: "live" | "fixture" | "fallback";
    warning: string | null;
    latencyMs: number;
    totalTokens: number | null;
  };
  initialPersistence?: ReportPersistenceState;
  initialAsset?: ReportAssetView | null;
  activationMetrics: ReportActivationMetric[];
  sourceReceiptId: string | null;
  telemetrySessionKey: string;
  telemetryStartedAtMs: number;
  activationDateBounds: { today: string; minimum: string };
  onStartOver: () => void;
}) {
  const router = useRouter();
  const [report, setReport] = useState(() => cloneDecisionReport(initialReport));
  const [titleDraft, setTitleDraft] = useState(initialReport.title);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [actionTitleDrafts, setActionTitleDrafts] = useState<Record<string, string>>({});
  const [editError, setEditError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveConflictReportId, setSaveConflictReportId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(
    initialPersistence ? "saved" : "waiting",
  );
  const [assetError, setAssetError] = useState<string | null>(null);
  const [asset, setAsset] = useState<ReportAssetView | null>(initialAsset ?? null);
  const [persistence, setPersistence] = useState<ReportPersistenceState | null>(
    initialPersistence ?? null,
  );
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(() =>
    initialPersistence ? JSON.stringify(initialReport) : null,
  );
  const [isChangingAsset, startChangingAsset] = useTransition();

  const reportSnapshot = JSON.stringify(report);
  const activationDraft = report.activationDraft ??
    emptyDecisionReportActivationDraft();
  const projectionMetricId = activationMetrics.find(
    (metric) => metric.name.trim().toLowerCase() === projection.metricName.trim().toLowerCase(),
  )?.metricId;
  const metricId = activationDraft.confirmedMetricId ??
    initialPersistence?.activation?.metricId ??
    projectionMetricId ??
    "";
  const metricAvailable = activationMetrics.some(
    (metric) => metric.metricId === metricId,
  );
  const selectedActionIds = report.activationDraft?.selectedActionSourceItemIds ??
    (initialPersistence?.activation?.primaryLeverActionId
      ? [initialPersistence.activation.primaryLeverActionId]
      : []);
  const primaryActionId = report.activationDraft?.primaryLeverActionSourceItemId ??
    initialPersistence?.activation?.primaryLeverActionId ??
    "";
  const gaps = scanDecisionReportGaps(report);
  const titleBlocked = titleDraft.trim() === "";
  const invalidActionTitleIds = report.implementation.actions
    .filter((action) =>
      (actionTitleDrafts[action.sourceItemId] ?? action.title).trim() === "",
    )
    .map((action) => action.sourceItemId);
  const invalidActionTitleKey = invalidActionTitleIds.join(":");
  const hasInvalidActionTitle = invalidActionTitleIds.length > 0;
  const hasActionTitleDraftChanges = report.implementation.actions.some(
    (action) =>
      (actionTitleDrafts[action.sourceItemId] ?? action.title) !== action.title,
  );
  const ready = !titleBlocked && !hasInvalidActionTitle && gaps.length === 0;
  const hasUnsavedChanges =
    savedSnapshot !== reportSnapshot ||
    titleDraft !== report.title ||
    hasActionTitleDraftChanges;
  const reportIsActive = persistence?.status === "active";

  const reportRef = useRef(report);
  const persistenceRef = useRef<ReportPersistenceState | null>(persistence);
  const savedSnapshotRef = useRef<string | null>(savedSnapshot);
  const pendingSaveRef = useRef<PendingSave | null>(null);
  const failedSaveRef = useRef<PendingSave | null>(null);
  const blockedSnapshotRef = useRef<string | null>(null);
  const conflictHaltedRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const assetMutationInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const editedFields = useRef(new Set<string>());
  const answeredFollowUps = useRef(new Set<string>());
  const drainSaveQueueRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    reportRef.current = report;
    persistenceRef.current = persistence;
    savedSnapshotRef.current = savedSnapshot;
  }, [persistence, report, savedSnapshot]);

  async function drainSaveQueue() {
    if (
      saveInFlightRef.current ||
      assetMutationInFlightRef.current ||
      conflictHaltedRef.current
    ) return;
    const pending = pendingSaveRef.current;
    if (!pending) return;
    pendingSaveRef.current = null;
    saveInFlightRef.current = true;
    if (mountedRef.current) {
      setSaveStatus("saving");
      setSaveError(null);
      setSaveConflictReportId(null);
    }

    const currentPersistence = persistenceRef.current;
    try {
      const result: SaveDecisionReportActionResult = await saveDecisionReportAction({
        reportId: currentPersistence?.reportId ?? null,
        baseRevisionId: currentPersistence?.revisionId ?? null,
        sourceReceiptId: currentPersistence ? null : sourceReceiptId,
        report: pending.report,
        metricProjection: projection,
        telemetry: currentPersistence
          ? undefined
          : {
              sessionKey: telemetrySessionKey,
              msSinceStart: Math.max(0, Math.round(performance.now() - telemetryStartedAtMs)),
              editCount: editedFields.current.size,
              followUpCount: answeredFollowUps.current.size,
              missingFieldCount: pending.missingFieldCount,
            },
      });

      if (!result.ok) {
        failedSaveRef.current = pending;
        blockedSnapshotRef.current = pending.snapshot;
        if (result.code === "conflict") {
          conflictHaltedRef.current = true;
        }
        if (mountedRef.current) {
          setSaveError(result.error);
          setSaveStatus(result.code === "conflict" ? "conflict" : "error");
          if (result.code === "conflict" && currentPersistence) {
            setSaveConflictReportId(currentPersistence.reportId);
          }
        }
        return;
      }

      const nextPersistence: ReportPersistenceState = {
        reportId: result.saved.reportId,
        revisionId: result.saved.revisionId,
        status: result.saved.status,
        savedAt: result.saved.savedAt,
        activation: currentPersistence?.activation ?? null,
      };
      persistenceRef.current = nextPersistence;
      savedSnapshotRef.current = pending.snapshot;
      failedSaveRef.current = null;
      blockedSnapshotRef.current = null;
      if (mountedRef.current) {
        setPersistence(nextPersistence);
        setSavedSnapshot(pending.snapshot);
        setSaveConflictReportId(null);
        setSaveStatus(JSON.stringify(reportRef.current) === pending.snapshot ? "saved" : "waiting");
      }
      if (!currentPersistence) {
        router.replace(`/onboarding?report=${result.saved.reportId}`, { scroll: false });
      }
    } catch {
      failedSaveRef.current = pending;
      blockedSnapshotRef.current = pending.snapshot;
      if (mountedRef.current) {
        setSaveError("Causent could not autosave this report. Your edits are still here.");
        setSaveStatus("error");
      }
    } finally {
      saveInFlightRef.current = false;
      if (pendingSaveRef.current && !conflictHaltedRef.current) {
        queueMicrotask(() => void drainSaveQueueRef.current());
      }
    }
  }

  useEffect(() => {
    drainSaveQueueRef.current = drainSaveQueue;
  });

  useEffect(() => {
    if (
      reportIsActive ||
      titleBlocked ||
      hasInvalidActionTitle ||
      conflictHaltedRef.current ||
      reportSnapshot === savedSnapshot ||
      reportSnapshot === blockedSnapshotRef.current
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (assetMutationInFlightRef.current || conflictHaltedRef.current) return;
      const candidate: PendingSave = {
        report: cloneDecisionReport(reportRef.current),
        snapshot: JSON.stringify(reportRef.current),
        missingFieldCount: scanDecisionReportGaps(reportRef.current).length,
      };
      if (failedSaveRef.current?.snapshot !== candidate.snapshot) {
        failedSaveRef.current = null;
      }
      pendingSaveRef.current = candidate;
      void drainSaveQueueRef.current();
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    hasInvalidActionTitle,
    invalidActionTitleKey,
    reportIsActive,
    reportSnapshot,
    savedSnapshot,
    titleBlocked,
  ]);

  useEffect(() => {
    if (!hasUnsavedChanges || reportIsActive) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedChanges, reportIsActive]);

  function startOver() {
    if (assetMutationInFlightRef.current) return;
    if (hasUnsavedChanges || saveInFlightRef.current) {
      const message = persistence
        ? "Discard changes that have not finished autosaving and start a new report? Your latest saved revision will remain in Reports."
        : "Discard this report and start over?";
      if (!window.confirm(message)) return;
    }
    onStartOver();
  }

  function dispatchEdit(command: ReportEditCommandV1, editKey: string): boolean {
    if (reportIsActive || assetMutationInFlightRef.current) return false;
    const result = applyReportEditCommand(reportRef.current, command);
    if (!result.ok) {
      setEditError(result.error);
      return false;
    }
    reportRef.current = result.report;
    setEditError(null);
    setSaveStatus(
      conflictHaltedRef.current
        ? "conflict"
        : JSON.stringify(result.report) === savedSnapshotRef.current
          ? "saved"
          : "waiting",
    );
    setReport(result.report);
    editedFields.current.add(editKey);
    return true;
  }

  function updateClaim(claimId: string, text: string) {
    dispatchEdit({ type: "replace_claim_text", claimId, text }, `claim:${claimId}`);
  }

  function updateActivationDraft(
    update: (draft: DecisionReportActivationDraft) => void,
    editKey: string,
  ) {
    const nextDraft = structuredClone(
      reportRef.current.activationDraft ??
        emptyDecisionReportActivationDraft(),
    );
    update(nextDraft);
    dispatchEdit(
      { type: "edit_activation_draft", activationDraft: nextDraft },
      editKey,
    );
  }

  function updateMetric(metricId: string) {
    updateActivationDraft((draft) => {
      draft.confirmedMetricId = metricId || null;
    }, "activation:metric");
  }

  function updatePredictionDirection(direction: "POSITIVE" | "NEGATIVE") {
    updateActivationDraft((draft) => {
      draft.prediction.direction = direction;
    }, "activation:prediction-direction");
  }

  function updatePredictionMagnitude(magnitudePctMean: number | null) {
    updateActivationDraft((draft) => {
      draft.prediction.magnitudePctMean = magnitudePctMean;
    }, "activation:prediction-magnitude");
  }

  function updatePredictionResolutionDate(resolutionDate: string | null) {
    updateActivationDraft((draft) => {
      draft.prediction.resolutionDate = resolutionDate;
    }, "activation:prediction-date");
  }

  function updateReportTitle(title: string) {
    if (reportIsActive || assetMutationInFlightRef.current) return;
    setTitleDraft(title);
    if (title.trim() === "") {
      const rejected = applyReportEditCommand(reportRef.current, {
        type: "edit_report_title",
        title,
      });
      setTitleError(rejected.ok ? null : rejected.error);
      setEditError(null);
      setSaveStatus(conflictHaltedRef.current ? "conflict" : "waiting");
      return;
    }
    const applied = dispatchEdit(
      { type: "edit_report_title", title },
      "report:title",
    );
    setTitleError(applied ? null : "Causent could not apply that report title.");
  }

  function addSupportingEvidence(text: string) {
    const claimId = `user-evidence-${crypto.randomUUID()}`;
    const applied = dispatchEdit(
      { type: "add_supporting_evidence", claimId, text },
      `claim:${claimId}`,
    );
    if (!applied) return;
    queueMicrotask(() => {
      const target = document.getElementById(`claim-${claimId}`);
      if (!(target instanceof HTMLTextAreaElement)) return;
      target.focus();
      target.setSelectionRange(text.length, text.length);
    });
  }

  function updateActionTitle(sourceItemId: string, title: string) {
    setActionTitleDrafts((current) => ({
      ...current,
      [sourceItemId]: title,
    }));
    if (title.trim() === "") {
      setEditError(null);
      setSaveStatus(conflictHaltedRef.current ? "conflict" : "waiting");
      return;
    }
    dispatchEdit(
      { type: "edit_action_title", sourceItemId, title },
      `action-title:${sourceItemId}`,
    );
  }

  function updateActionSummary(sourceItemId: string, text: string) {
    dispatchEdit({ type: "edit_action_summary", sourceItemId, text }, `action-summary:${sourceItemId}`);
  }

  function updateActionOwner(sourceItemId: string, text: string) {
    dispatchEdit({ type: "edit_action_owner", sourceItemId, text }, `action-owner:${sourceItemId}`);
  }

  function updateActionExecution(sourceItemId: string, patch: ActionExecutionPatch) {
    const action = reportRef.current.implementation.actions.find(
      (candidate) => candidate.sourceItemId === sourceItemId,
    );
    if (!action) return;
    dispatchEdit(
      {
        type: "edit_action_execution",
        sourceItemId,
        priority: patch.priority ?? action.priority ?? 2,
        tags: patch.tags ?? action.tags ?? [],
        skills: patch.skills ?? action.skills ?? [],
        estimatedTime: patch.estimatedTime ?? action.estimatedTime ?? "",
        estimatedCost: patch.estimatedCost ?? action.estimatedCost ?? "",
      },
      `action-execution:${sourceItemId}`,
    );
  }

  function addAction() {
    dispatchEdit({
      type: "add_action",
      sourceItemId: `user-action-${crypto.randomUUID()}`,
      title: "New action",
      summary: "",
    }, "action:add");
  }

  function addCustomer(text: string) {
    const claimId = reportRef.current.implementation.customers.length === 0
      ? "user-customer-draft"
      : `user-customer-${crypto.randomUUID()}`;
    dispatchEdit(
      { type: "add_customer", claimId, text },
      `claim:${claimId}`,
    );
  }

  function addStakeholder(text: string) {
    const claimId = reportRef.current.implementation.stakeholders.length === 0
      ? "user-stakeholder-draft"
      : `user-stakeholder-${crypto.randomUUID()}`;
    dispatchEdit(
      { type: "add_stakeholder", claimId, text },
      `claim:${claimId}`,
    );
  }

  function removeAction(sourceItemId: string) {
    if (!dispatchEdit({ type: "remove_action", sourceItemId }, `action-remove:${sourceItemId}`)) {
      return;
    }
    setActionTitleDrafts((current) => {
      const next = { ...current };
      delete next[sourceItemId];
      return next;
    });
  }

  function toggleActionSelection(sourceItemId: string) {
    updateActivationDraft((draft) => {
      const current = draft.selectedActionSourceItemIds;
      if (current.includes(sourceItemId)) {
        draft.selectedActionSourceItemIds = current.filter(
          (id) => id !== sourceItemId,
        );
        if (draft.primaryLeverActionSourceItemId === sourceItemId) {
          draft.primaryLeverActionSourceItemId = null;
        }
        return;
      }
      if (current.length >= 3) return;
      draft.selectedActionSourceItemIds = [...current, sourceItemId];
      if (!draft.primaryLeverActionSourceItemId) {
        draft.primaryLeverActionSourceItemId = sourceItemId;
      }
    }, `activation:action:${sourceItemId}`);
  }

  function updatePrimaryAction(sourceItemId: string) {
    updateActivationDraft((draft) => {
      draft.primaryLeverActionSourceItemId = sourceItemId;
    }, "activation:primary-action");
  }

  function focusGap(gap: DecisionReportGap) {
    const target = document.getElementById(gap.targetId);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
  }

  function answerGap(gap: DecisionReportGap, answer: string): boolean {
    const command = createGapAnswerCommand(
      gap,
      answer,
      gap.kind === "action" ? `user-action-${crypto.randomUUID()}` : undefined,
    );
    if (!command.ok) {
      setEditError(command.error);
      return false;
    }
    const applied = dispatchEdit(command.command, `gap:${gap.targetId}`);
    if (applied) answeredFollowUps.current.add(gap.targetId);
    return applied;
  }

  function retryAutosave() {
    if (conflictHaltedRef.current) return;
    const candidate = failedSaveRef.current;
    if (!candidate) return;
    blockedSnapshotRef.current = null;
    pendingSaveRef.current = candidate;
    void drainSaveQueueRef.current();
  }

  function uploadAsset(file: File) {
    const currentPersistence = persistenceRef.current;
    const currentReport = reportRef.current;
    if (
      !currentPersistence ||
      reportIsActive ||
      conflictHaltedRef.current ||
      assetMutationInFlightRef.current ||
      saveInFlightRef.current ||
      pendingSaveRef.current !== null ||
      titleDraft !== currentReport.title ||
      hasActionTitleDraftChanges ||
      savedSnapshotRef.current !== JSON.stringify(currentReport)
    ) {
      setAssetError("Wait for autosave to finish before adding a chart or graph.");
      return;
    }
    setAssetError(null);
    assetMutationInFlightRef.current = true;
    startChangingAsset(async () => {
      const formData = new FormData();
      formData.set("image", file);
      try {
        const result = await uploadDecisionReportImageAction({
          reportId: currentPersistence.reportId,
          baseRevisionId: currentPersistence.revisionId,
          report: currentReport,
          metricProjection: projection,
        }, formData);
        if (!result.ok) {
          setAssetError(result.error);
          if (result.code === "conflict") {
            conflictHaltedRef.current = true;
            setSaveError(result.error);
            setSaveConflictReportId(currentPersistence.reportId);
            setSaveStatus("conflict");
          }
          return;
        }
        const nextReport = cloneDecisionReport(currentReport);
        nextReport.implementation.assetIds = result.asset ? [result.asset.assetId] : [];
        const nextSnapshot = JSON.stringify(nextReport);
        const nextPersistence = {
          ...currentPersistence,
          revisionId: result.revisionId,
          status: result.status,
          savedAt: new Date().toISOString(),
        };
        reportRef.current = nextReport;
        persistenceRef.current = nextPersistence;
        savedSnapshotRef.current = nextSnapshot;
        setReport(nextReport);
        setAsset(result.asset);
        setPersistence(nextPersistence);
        setSavedSnapshot(nextSnapshot);
        setSaveError(null);
        setSaveConflictReportId(null);
        setSaveStatus("saved");
        editedFields.current.add("implementation:asset");
      } catch {
        setAssetError("Causent could not process that image. Your report was not changed—try again.");
      } finally {
        assetMutationInFlightRef.current = false;
      }
    });
  }

  function removeAsset() {
    const currentPersistence = persistenceRef.current;
    const currentReport = reportRef.current;
    if (
      !currentPersistence ||
      !asset ||
      reportIsActive ||
      conflictHaltedRef.current ||
      assetMutationInFlightRef.current ||
      saveInFlightRef.current ||
      pendingSaveRef.current !== null ||
      titleDraft !== currentReport.title ||
      hasActionTitleDraftChanges ||
      savedSnapshotRef.current !== JSON.stringify(currentReport)
    ) {
      setAssetError("Wait for autosave to finish before removing this chart or graph.");
      return;
    }
    setAssetError(null);
    assetMutationInFlightRef.current = true;
    startChangingAsset(async () => {
      try {
        const result = await removeDecisionReportImageAction({
          reportId: currentPersistence.reportId,
          baseRevisionId: currentPersistence.revisionId,
          report: currentReport,
          metricProjection: projection,
        }, asset.assetId);
        if (!result.ok) {
          setAssetError(result.error);
          if (result.code === "conflict") {
            conflictHaltedRef.current = true;
            setSaveError(result.error);
            setSaveConflictReportId(currentPersistence.reportId);
            setSaveStatus("conflict");
          }
          return;
        }
        const nextReport = cloneDecisionReport(currentReport);
        nextReport.implementation.assetIds = [];
        const nextSnapshot = JSON.stringify(nextReport);
        const nextPersistence = {
          ...currentPersistence,
          revisionId: result.revisionId,
          status: result.status,
          savedAt: new Date().toISOString(),
        };
        reportRef.current = nextReport;
        persistenceRef.current = nextPersistence;
        savedSnapshotRef.current = nextSnapshot;
        setReport(nextReport);
        setAsset(null);
        setPersistence(nextPersistence);
        setSavedSnapshot(nextSnapshot);
        setSaveError(null);
        setSaveConflictReportId(null);
        setSaveStatus("saved");
        editedFields.current.add("implementation:asset");
      } catch {
        setAssetError("Causent could not remove that image. It remains private and attached—try again.");
      } finally {
        assetMutationInFlightRef.current = false;
      }
    });
  }

  const assetDisabled =
    !persistence ||
    isChangingAsset ||
    hasUnsavedChanges ||
    saveStatus === "waiting" ||
    saveStatus === "saving" ||
    saveStatus === "error" ||
    saveStatus === "conflict";
  const editorReadOnly = reportIsActive || isChangingAsset;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 pb-16">
      {generationMeta?.warning ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-5 text-amber-900" role="status">
          {generationMeta.warning}
        </div>
      ) : null}
      <article className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm shadow-slate-200/40">
        <header className="px-5 py-7 sm:px-9 sm:py-9">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-[var(--text-muted)]">
                <span>{workspaceName}</span>
                <span aria-hidden>·</span>
                <span>{projectName}</span>
                <span className={`rounded-full px-2.5 py-1 font-semibold ${reportIsActive ? "bg-teal-50 text-teal-800" : "bg-slate-100 text-slate-700"}`}>
                  {reportIsActive ? "Active" : "Draft"}
                </span>
              </div>
              <input
                id="report-title"
                className={`mt-3 w-full rounded-lg border bg-transparent px-2 py-1 text-[28px] font-semibold leading-tight tracking-[-0.025em] text-[var(--text)] outline-none sm:text-[34px] ${titleBlocked ? "border-amber-400 bg-amber-50/70 focus:border-amber-500" : "border-transparent focus:border-[var(--brand-blue)]"}`}
                aria-label="Report title"
                aria-describedby={titleError ? "report-title-error" : undefined}
                aria-invalid={titleBlocked}
                value={titleDraft}
                disabled={editorReadOnly}
                onChange={(event) => updateReportTitle(event.target.value)}
              />
              {titleError ? (
                <p id="report-title-error" className="mt-1 px-2 text-[11px] font-medium text-amber-800" role="alert">
                  {titleError} Add a title to resume autosave and activation.
                </p>
              ) : null}
            </div>
            <button type="button" className="min-h-11 rounded-lg border border-[var(--border)] px-3 py-2 text-[12px] font-medium text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40" disabled={isChangingAsset} onClick={startOver}>
              {reportIsActive ? "New report" : "Start over"}
            </button>
          </div>
        </header>

        <div
          className="border-t border-[var(--border)] bg-white"
          role="region"
          aria-labelledby="decision-document-editor-heading"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-slate-50/70 px-5 py-3 sm:px-9">
            <div>
              <p id="decision-document-editor-heading" className="text-[12px] font-semibold text-[var(--text)]">
                Decision document
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                {reportIsActive
                  ? "This activated report is read-only."
                  : "Click into any paragraph to edit. Each block expands as you write."}
              </p>
            </div>
            {!reportIsActive ? (
              <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[10px] font-semibold text-teal-800">
                Autosaves
              </span>
            ) : null}
          </div>

          <DecisionSection decision={report.decision} readOnly={editorReadOnly} onClaimChange={updateClaim} />
          <SupportingEvidenceSection
            evidence={report.supportingEvidence}
            asset={asset}
            assetPending={isChangingAsset}
            assetDisabled={assetDisabled}
            assetError={assetError}
            readOnly={editorReadOnly}
            onClaimChange={updateClaim}
            onClaimAdd={addSupportingEvidence}
            onAssetUpload={uploadAsset}
            onAssetRemove={removeAsset}
          />
          <ReportCoreMetricsSection
            projection={projection}
            metrics={activationMetrics}
            metricId={metricId}
            reportId={persistence?.reportId ?? null}
            readOnly={editorReadOnly}
            onMetricChange={updateMetric}
          />
          <ImplementationSection
            implementation={report.implementation}
            projection={projection}
            readOnly={editorReadOnly}
            onClaimChange={updateClaim}
            onActionTitleChange={updateActionTitle}
            onActionSummaryChange={updateActionSummary}
            onActionOwnerChange={updateActionOwner}
            onActionExecutionChange={updateActionExecution}
            actionTitleDrafts={actionTitleDrafts}
            invalidActionTitleIds={invalidActionTitleIds}
            selectedActionIds={selectedActionIds}
            primaryActionId={primaryActionId}
            onActionSelectionChange={toggleActionSelection}
            onPrimaryActionChange={updatePrimaryAction}
            onActionAdd={addAction}
            onActionRemove={removeAction}
            onCustomerAdd={addCustomer}
            onStakeholderAdd={addStakeholder}
          />
        </div>

        <footer className="border-t border-[var(--border)] px-5 py-4 text-[10px] leading-4 text-[var(--text-muted)] sm:px-9">
          <span className="font-semibold text-[var(--text)]">AI Assisted</span>
          {generationMeta?.mode === "live"
            ? ` · ${(generationMeta.latencyMs / 1000).toFixed(1)}s${generationMeta.totalTokens ? ` · ${generationMeta.totalTokens.toLocaleString()} tokens` : ""}`
            : generationMeta?.mode === "fixture"
              ? " · sample fixture"
              : generationMeta?.mode === "fallback"
                ? " · safe fallback"
                : ""}
          {reportIsActive ? " · This activated revision is locked." : " · Complete the highlighted fields before activation."}
        </footer>
      </article>

      {!reportIsActive && !titleBlocked && !hasInvalidActionTitle ? (
        <ReportCompletionPanel gaps={gaps} onAnswer={answerGap} onFocus={focusGap} />
      ) : null}

      {ready ? (
        <ReportActivationPanel
          persistence={persistence}
          hasUnsavedChanges={hasUnsavedChanges || isChangingAsset}
          metricId={metricId}
          metricAvailable={metricAvailable}
          selectedActionIds={selectedActionIds}
          primaryActionId={primaryActionId}
          direction={activationDraft.prediction.direction}
          magnitudePctMean={activationDraft.prediction.magnitudePctMean}
          resolutionDate={activationDraft.prediction.resolutionDate ?? ""}
          onDirectionChange={updatePredictionDirection}
          onMagnitudeChange={updatePredictionMagnitude}
          onResolutionDateChange={updatePredictionResolutionDate}
          telemetrySessionKey={telemetrySessionKey}
          telemetryStartedAtMs={telemetryStartedAtMs}
          activationDateBounds={activationDateBounds}
        />
      ) : null}

      {editError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800" role="alert">
          {editError}
        </p>
      ) : null}

      {saveError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800" role="alert">
          <p>{saveError}</p>
          {saveConflictReportId ? (
            <p className="mt-2 leading-5">
              Your edits remain in this tab. Open the latest saved report in a new tab to compare revisions.{" "}
              <Link className="font-semibold underline underline-offset-2" href={`/onboarding?report=${saveConflictReportId}`} target="_blank" rel="noopener noreferrer">
                Open latest saved report
              </Link>
            </p>
          ) : (
            <button type="button" className="mt-2 font-semibold underline underline-offset-2" onClick={retryAutosave}>
              Retry autosave
            </button>
          )}
        </div>
      ) : null}

      {!reportIsActive ? (
        <div
          className={`sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 shadow-lg shadow-slate-300/30 backdrop-blur ${ready ? "border-emerald-200 bg-emerald-50/95" : "border-[var(--border)] bg-white/95"}`}
          aria-live="polite"
        >
          <div>
            <p className={`text-[12px] font-semibold ${ready ? "text-emerald-900" : "text-[var(--text)]"}`}>
              {ready ? "Report complete" : "A few details still need you"}
            </p>
            <p className={`text-[11px] ${ready ? "text-emerald-900/75" : "text-[var(--text-muted)]"}`}>
              {saveStatus === "conflict"
                ? "Autosave stopped because this report changed elsewhere."
                : titleBlocked
                  ? "Add a report title to resume autosave."
                  : hasInvalidActionTitle
                    ? "Add an action title to resume autosave."
                  : saveStatus === "error"
                    ? "Autosave paused. Your edits are still here."
                    : saveStatus === "saving"
                      ? "Autosaving…"
                      : isChangingAsset
                        ? "Updating the private chart…"
                        : saveStatus === "waiting" || hasUnsavedChanges
                          ? "Changes will save automatically."
                          : "All changes saved."}
            </p>
          </div>
          {!ready ? (
            <button
              type="button"
              className="rounded-lg bg-[var(--text)] px-4 py-2 text-[12px] font-semibold text-white"
              aria-controls={
                titleBlocked
                  ? "report-title"
                  : hasInvalidActionTitle
                    ? `action-title-${invalidActionTitleIds[0]}`
                    : gaps[0].targetId
              }
              onClick={() => {
                if (titleBlocked) {
                  document.getElementById("report-title")?.focus();
                  return;
                }
                if (hasInvalidActionTitle) {
                  document.getElementById(`action-title-${invalidActionTitleIds[0]}`)?.focus();
                  return;
                }
                focusGap(gaps[0]);
              }}
            >
              Review next required field
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
