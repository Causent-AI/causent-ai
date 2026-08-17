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
import { startDecisionReportAction } from "@/app/(onboarding)/onboarding/decision-report-activation-actions";
import { ActionPlanCanvas } from "@/components/decision-report/ActionPlanCanvas";
import { DecisionNarrativeCanvas } from "@/components/decision-report/DecisionNarrativeCanvas";
import {
  type ActionExecutionPatch,
} from "@/components/decision-report/ImplementationSection";
import { DocumentEditorProvider } from "@/components/decision-report/rich-text/DocumentEditorContext";
import { DocumentEditorToolbar } from "@/components/decision-report/rich-text/DocumentEditorToolbar";
import type { ReportCanvasDocumentChange } from "@/components/decision-report/rich-text/ReportCanvasEditor";
import { AutoGrowingTextarea } from "@/components/ui/AutoGrowingTextarea";
import { decisionReportActionDestination } from "@/lib/decision-reports/action-navigation";
import type { ReportAssetView } from "@/lib/decision-reports/assets";
import {
  applyReportEditCommand,
  scanDecisionReportGaps,
  type DecisionReportGap,
  type ReportEditCommandV1,
} from "@/lib/decision-reports/editing";
import type { ReportActivationMetric } from "@/lib/decision-reports/materialization";
import type {
  DecisionReportActivationPointer,
  DecisionReportPersistenceStatus,
} from "@/lib/decision-reports/persistence";
import { reportLifecyclePresentation } from "@/lib/decision-reports/product-continuity";
import {
  cloneDecisionReport,
  emptyDecisionReportActivationDraft,
  flattenPortableRichText,
  type DecisionReportActivationDraft,
  type DecisionReportV1,
  type MetricProjection,
  type PortableRichTextDocument,
  resolveDecisionReportSelectedMetricIds,
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

function focusEditableAtEnd(target: HTMLElement) {
  target.focus();
  if (!target.isContentEditable) return;
  const selection = target.ownerDocument.getSelection();
  if (!selection) return;
  const range = target.ownerDocument.createRange();
  range.selectNodeContents(target);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

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
  const [startError, setStartError] = useState<string | null>(null);
  const [startPendingActionId, setStartPendingActionId] = useState<string | null>(null);
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
  const [isStartingAction, startActionTransition] = useTransition();

  const reportSnapshot = JSON.stringify(report);
  const reportIsActive = persistence?.status === "active";
  const activationDraft = report.activationDraft ??
    emptyDecisionReportActivationDraft();
  const projectionMetricId = activationMetrics.find(
    (metric) => metric.name.trim().toLowerCase() === projection.metricName.trim().toLowerCase(),
  )?.metricId;
  const metricId = activationDraft.confirmedMetricId ??
    initialPersistence?.activation?.metricId ??
    projectionMetricId ??
    "";
  const selectedMetricIds = (() => {
    const selected = resolveDecisionReportSelectedMetricIds(activationDraft);
    return selected.length > 0
      ? selected
      : metricId
        ? [metricId]
        : [];
  })();
  const metricAvailable = activationMetrics.some(
    (metric) => metric.metricId === metricId,
  );
  const selectedActionIds = reportIsActive
    ? report.activationDraft?.selectedActionSourceItemIds ??
      (initialPersistence?.activation?.primaryLeverActionId
        ? [initialPersistence.activation.primaryLeverActionId]
        : [])
    : report.implementation.actions.map((action) => action.sourceItemId);
  const primaryActionId = report.activationDraft?.primaryLeverActionSourceItemId ??
    initialPersistence?.activation?.primaryLeverActionId ??
    selectedActionIds[0] ??
    "";
  const actionMetricAssignments = selectedActionIds.flatMap((sourceItemId) => {
    const action = report.implementation.actions.find(
      (candidate) => candidate.sourceItemId === sourceItemId,
    );
    if (!action) return [];
    const assignedMetricId = sourceItemId === primaryActionId
      ? metricId
      : action.metricId ?? metricId;
    return assignedMetricId
      ? [{ actionSourceItemId: sourceItemId, metricId: assignedMetricId }]
      : [];
  });
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
  const exactSavedRevision =
    persistence?.status === "report_ready" &&
    !hasUnsavedChanges &&
    !isChangingAsset;
  const magnitudeReady =
    activationDraft.prediction.magnitudePctMean !== null &&
    Number.isFinite(activationDraft.prediction.magnitudePctMean) &&
    activationDraft.prediction.magnitudePctMean > 0;
  const resolutionDate = activationDraft.prediction.resolutionDate ?? "";
  const resolutionDateReady =
    /^\d{4}-\d{2}-\d{2}$/.test(resolutionDate) &&
    resolutionDate > activationDateBounds.today;
  const assignedActionIds = new Set(
    actionMetricAssignments.map((assignment) => assignment.actionSourceItemId),
  );
  const activationInputsReady =
    metricAvailable &&
    selectedMetricIds.length >= 1 &&
    selectedMetricIds.length <= 5 &&
    selectedMetricIds.includes(metricId) &&
    selectedActionIds.length >= 1 &&
    selectedActionIds.length <= 25 &&
    selectedActionIds.includes(primaryActionId) &&
    actionMetricAssignments.length === selectedActionIds.length &&
    assignedActionIds.size === actionMetricAssignments.length &&
    actionMetricAssignments.every((assignment) =>
      selectedMetricIds.includes(assignment.metricId)
    ) &&
    actionMetricAssignments.find(
      (assignment) => assignment.actionSourceItemId === primaryActionId,
    )?.metricId === metricId &&
    magnitudeReady &&
    resolutionDateReady;
  const requiredFieldCount =
    gaps.length + (titleBlocked ? 1 : 0) + invalidActionTitleIds.length;
  const lifecycle = reportLifecyclePresentation({
    active: reportIsActive,
    requiredFieldCount,
    commitmentReady: activationInputsReady,
    actionCount: selectedActionIds.length,
  });
  const firstInvalidAssignment = actionMetricAssignments.find(
    (assignment) => !selectedMetricIds.includes(assignment.metricId),
  );
  const nextCommitmentTargetId = (() => {
    if (activationMetrics.length === 0) return "core-metrics-manage";
    if (
      !metricAvailable ||
      selectedMetricIds.length < 1 ||
      selectedMetricIds.length > 5 ||
      !selectedMetricIds.includes(metricId)
    ) {
      return metricId && selectedMetricIds.includes(metricId)
        ? `primary-metric-${metricId}`
        : `core-metric-${activationMetrics[0].metricId}`;
    }
    if (selectedActionIds.length === 0) return "report-actions-empty";
    if (!selectedActionIds.includes(primaryActionId)) {
      return "commitment-primary-action";
    }
    if (firstInvalidAssignment) {
      return `action-metric-${firstInvalidAssignment.actionSourceItemId}`;
    }
    if (!magnitudeReady) return "commitment-magnitude";
    if (!resolutionDateReady) return "commitment-date";
    return "report-decision-commitment";
  })();

  const reportRef = useRef(report);
  const persistenceRef = useRef<ReportPersistenceState | null>(persistence);
  const savedSnapshotRef = useRef<string | null>(savedSnapshot);
  const pendingSaveRef = useRef<PendingSave | null>(null);
  const failedSaveRef = useRef<PendingSave | null>(null);
  const blockedSnapshotRef = useRef<string | null>(null);
  const conflictHaltedRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const assetMutationInFlightRef = useRef(false);
  const actionStartInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const editedFields = useRef(new Set<string>());
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
              followUpCount: 0,
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

  function updateCanvasDocuments(
    canvasId: "decision" | "action_plan",
    changes: ReportCanvasDocumentChange[],
  ) {
    dispatchEdit(
      {
        type: "replace_canvas_documents",
        canvasId,
        documents: changes,
      },
      `canvas:${canvasId}`,
    );
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

  function toggleMetric(metricId: string) {
    const wasSelected = selectedMetricIds.includes(metricId);
    updateActivationDraft((draft) => {
      const stored = resolveDecisionReportSelectedMetricIds(draft);
      const current = stored.length > 0 ? stored : selectedMetricIds;
      const next = wasSelected
        ? current.filter((selectedId) => selectedId !== metricId)
        : [...current, metricId].slice(0, 5);
      draft.selectedMetricIds = next;
      if (!draft.confirmedMetricId || !next.includes(draft.confirmedMetricId)) {
        draft.confirmedMetricId = next[0] ?? null;
      }
    }, `activation:metric:${metricId}`);
  }

  function updatePrimaryMetric(metricId: string) {
    updateActivationDraft((draft) => {
      const stored = resolveDecisionReportSelectedMetricIds(draft);
      const selected = stored.length > 0 ? stored : selectedMetricIds;
      draft.selectedMetricIds = selected.includes(metricId)
        ? selected
        : [...selected, metricId].slice(0, 5);
      draft.confirmedMetricId = metricId;
    }, "activation:primary-metric");
    const primary = reportRef.current.implementation.actions.find(
      (action) => action.sourceItemId === primaryActionId,
    );
    if (primary && primary.metricId !== metricId) {
      dispatchEdit(
        {
          type: "edit_action_metric",
          sourceItemId: primary.sourceItemId,
          metricId,
        },
        `action-metric:${primary.sourceItemId}`,
      );
    }
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
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`claim-${claimId}`);
      if (!(target instanceof HTMLElement)) return;
      focusEditableAtEnd(target);
    });
  }

  function addSupportingEvidenceDocument(
    document: PortableRichTextDocument,
  ) {
    const claimId = `user-evidence-${crypto.randomUUID()}`;
    const added = dispatchEdit(
      {
        type: "add_supporting_evidence",
        claimId,
        text: flattenPortableRichText(document),
      },
      `claim:${claimId}`,
    );
    if (!added) return;
    const formatted = dispatchEdit(
      { type: "replace_claim_document", claimId, document },
      `claim:${claimId}`,
    );
    if (!formatted) return;
    window.requestAnimationFrame(() => {
      const target = window.document.getElementById(`claim-${claimId}`);
      if (!(target instanceof HTMLElement)) return;
      focusEditableAtEnd(target);
    });
  }

  function removeSupportingEvidence(claimId: string) {
    dispatchEdit(
      { type: "remove_supporting_evidence", claimId },
      `claim-remove:${claimId}`,
    );
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

  function updateActionMetric(sourceItemId: string, nextMetricId: string | null) {
    const currentPrimaryMetricId =
      reportRef.current.activationDraft?.confirmedMetricId ?? metricId;
    if (
      sourceItemId === primaryActionId &&
      nextMetricId !== null &&
      nextMetricId !== currentPrimaryMetricId
    ) {
      setEditError("The primary action uses the outcome metric.");
      return;
    }
    dispatchEdit(
      { type: "edit_action_metric", sourceItemId, metricId: nextMetricId },
      `action-metric:${sourceItemId}`,
    );
  }

  function updateActionOwner(sourceItemId: string, text: string) {
    dispatchEdit({ type: "edit_action_owner", sourceItemId, text }, `action-owner:${sourceItemId}`);
  }

  function updateActionMonitoring(
    sourceItemId: string,
    expectedDirection: "INCREASE" | "DECREASE" | null,
    checkDate: string | null,
  ) {
    dispatchEdit(
      {
        type: "edit_action_monitoring",
        sourceItemId,
        expectedDirection,
        checkDate,
      },
      `action-monitoring:${sourceItemId}`,
    );
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

  function updatePrimaryAction(sourceItemId: string) {
    updateActivationDraft((draft) => {
      draft.selectedActionSourceItemIds = reportRef.current.implementation.actions.map(
        (action) => action.sourceItemId,
      );
      draft.primaryLeverActionSourceItemId = sourceItemId;
    }, "activation:primary-action");
    const action = reportRef.current.implementation.actions.find(
      (candidate) => candidate.sourceItemId === sourceItemId,
    );
    if (action && (action.monitoringExpectedDirection || action.monitoringCheckDate)) {
      updateActionMonitoring(sourceItemId, null, null);
    }
    if (action && metricId && action.metricId !== metricId) {
      updateActionMetric(sourceItemId, metricId);
    }
  }

  function focusGap(gap: DecisionReportGap) {
    const target = document.getElementById(gap.targetId);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
  }

  function focusLifecycleTarget(targetId: string) {
    const target = document.getElementById(targetId);
    if (!(target instanceof HTMLElement)) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
  }

  function retryAutosave() {
    if (conflictHaltedRef.current) return;
    const candidate = failedSaveRef.current;
    if (!candidate) return;
    blockedSnapshotRef.current = null;
    pendingSaveRef.current = candidate;
    void drainSaveQueueRef.current();
  }

  function startReportAction(sourceItemId: string) {
    const currentPersistence = persistenceRef.current;
    const alreadyActive =
      currentPersistence?.status === "active" &&
      currentPersistence.activation !== null;
    if (
      actionStartInFlightRef.current ||
      !currentPersistence ||
      !selectedActionIds.includes(sourceItemId) ||
      (!alreadyActive &&
        (!exactSavedRevision || !ready || !activationInputsReady))
    ) {
      return;
    }

    actionStartInFlightRef.current = true;
    setStartError(null);
    setStartPendingActionId(sourceItemId);
    startActionTransition(async () => {
      try {
        const result = await startDecisionReportAction({
          schemaVersion: 2,
          reportId: currentPersistence.reportId,
          revisionId: currentPersistence.revisionId,
          confirmedMetricId: metricId,
          selectedMetricIds,
          prediction: {
            direction: activationDraft.prediction.direction,
            magnitudePctMean: activationDraft.prediction.magnitudePctMean!,
            resolutionDate,
          },
          selectedActionSourceItemIds: selectedActionIds,
          actionMetricAssignments,
          primaryLeverActionSourceItemId: primaryActionId,
        }, sourceItemId, {
          sessionKey: telemetrySessionKey,
          msSinceStart: Math.max(
            0,
            Math.round(performance.now() - telemetryStartedAtMs),
          ),
        });
        if (!result.ok) {
          setStartError(result.error);
          return;
        }

        const nextPersistence: ReportPersistenceState = {
          ...currentPersistence,
          status: "active",
          activation: {
            activationId: result.activation.activationId,
            decisionId: result.activation.decisionId,
            predictionId: result.activation.predictionId,
            metricId,
            primaryLeverActionId: result.activation.primaryLeverActionId,
            activatedAt: result.activation.activatedAt,
          },
        };
        persistenceRef.current = nextPersistence;
        setPersistence(nextPersistence);
        router.push(
          decisionReportActionDestination({
            actionId: result.selectedActionId,
            decisionId: result.activation.decisionId,
          }),
        );
      } catch {
        setStartError(
          "Causent could not confirm whether this action started. Reload the report before trying again.",
        );
      } finally {
        actionStartInFlightRef.current = false;
        setStartPendingActionId(null);
      }
    });
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
    isStartingAction ||
    hasUnsavedChanges ||
    saveStatus === "waiting" ||
    saveStatus === "saving" ||
    saveStatus === "error" ||
    saveStatus === "conflict";
  const editorReadOnly = reportIsActive || isChangingAsset || isStartingAction;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 pb-16">
      {generationMeta?.warning ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-5 text-amber-900" role="status">
          {generationMeta.warning}
        </div>
      ) : null}
      <article className="overflow-clip rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm shadow-slate-200/40">
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
              <AutoGrowingTextarea
                id="report-title"
                rows={1}
                className={`mt-3 min-h-11 w-full rounded-lg border bg-transparent px-2 py-1 text-[28px] font-semibold leading-tight tracking-[-0.025em] text-[var(--text)] outline-none sm:text-[34px] ${titleBlocked ? "border-amber-400 bg-amber-50/70 focus:border-amber-500" : "border-transparent focus:border-[var(--brand-blue)]"}`}
                aria-label="Report title"
                aria-describedby={titleError ? "report-title-error" : undefined}
                aria-invalid={titleBlocked}
                value={titleDraft}
                disabled={editorReadOnly}
                onChange={(event) =>
                  updateReportTitle(event.target.value.replace(/[\r\n]+/g, " "))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault();
                }}
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

        <DocumentEditorProvider>
          <div
            className="border-t border-[var(--border)] bg-white"
            role="region"
            aria-label="Decision report editor"
          >
            {!reportIsActive ? (
              <div className="sticky top-0 z-20 min-w-0 max-w-full overflow-hidden border-b border-[var(--border)] bg-white/95 px-2 py-1.5 shadow-sm shadow-slate-200/30 backdrop-blur md:hidden">
                <DocumentEditorToolbar
                  readOnly={editorReadOnly}
                  variant="mobile"
                />
              </div>
            ) : null}

            <DecisionNarrativeCanvas
              report={report}
              asset={asset}
              assetPending={isChangingAsset}
              assetDisabled={assetDisabled}
              assetError={assetError}
              readOnly={editorReadOnly}
              onDocumentsChange={(changes) =>
                updateCanvasDocuments("decision", changes)
              }
              onEvidenceAdd={addSupportingEvidence}
              onEvidenceDocumentAdd={addSupportingEvidenceDocument}
              onEvidenceRemove={removeSupportingEvidence}
              onAssetUpload={uploadAsset}
              onAssetRemove={removeAsset}
            />
            <ActionPlanCanvas
              report={report}
              projection={projection}
              metrics={activationMetrics}
              selectedMetricIds={selectedMetricIds}
              primaryMetricId={metricId}
              primaryActionId={primaryActionId}
              includedActionIds={selectedActionIds}
              reportId={persistence?.reportId ?? null}
              readOnly={editorReadOnly}
              actionTitleDrafts={actionTitleDrafts}
              invalidActionTitleIds={invalidActionTitleIds}
              direction={activationDraft.prediction.direction}
              magnitudePctMean={activationDraft.prediction.magnitudePctMean}
              resolutionDate={resolutionDate}
              activationDateBounds={activationDateBounds}
              exactSavedRevision={exactSavedRevision}
              startReady={ready && activationInputsReady}
              startPendingActionId={startPendingActionId}
              startError={startError}
              activeDecisionId={persistence?.activation?.decisionId ?? null}
              activationCommittedAt={persistence?.activation?.activatedAt ?? null}
              onDocumentsChange={(changes) =>
                updateCanvasDocuments("action_plan", changes)
              }
              onMetricToggle={toggleMetric}
              onPrimaryMetricChange={updatePrimaryMetric}
              onActionMetricChange={updateActionMetric}
              onActionTitleChange={updateActionTitle}
              onActionOwnerChange={updateActionOwner}
              onActionMonitoringChange={updateActionMonitoring}
              onActionExecutionChange={updateActionExecution}
              onPrimaryActionChange={updatePrimaryAction}
              onActionAdd={addAction}
              onActionRemove={removeAction}
              onClaimChange={updateClaim}
              onCustomerAdd={addCustomer}
              onStakeholderAdd={addStakeholder}
              onDirectionChange={updatePredictionDirection}
              onMagnitudeChange={updatePredictionMagnitude}
              onResolutionDateChange={updatePredictionResolutionDate}
              onStartAction={startReportAction}
            />
          </div>
        </DocumentEditorProvider>
      </article>

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

      <div
        className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-white/95 px-4 py-3 shadow-lg shadow-slate-300/30 backdrop-blur"
        aria-live="polite"
      >
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--brand-teal)]">
              {lifecycle.label}
            </p>
            <p className="mt-0.5 text-[12px] font-semibold text-[var(--text)]">{lifecycle.title}</p>
            {lifecycle.detail ? (
              <p className="text-[11px] text-[var(--text-muted)]">
                {lifecycle.stage === "start_action" && !exactSavedRevision
                  ? saveStatus === "conflict"
                    ? "Resolve the save conflict before starting."
                    : saveStatus === "error"
                      ? "Retry autosave before starting."
                      : "Saving commitment…"
                  : lifecycle.detail}
              </p>
            ) : null}
          </div>
          {lifecycle.actionLabel ? <button
            type="button"
            className="min-h-11 rounded-lg bg-[var(--text)] px-4 py-2 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            disabled={
              isChangingAsset ||
              isStartingAction ||
              (lifecycle.stage === "start_action" && !exactSavedRevision)
            }
            aria-controls={
              lifecycle.stage === "finish_report"
                ? titleBlocked
                  ? "report-title"
                  : hasInvalidActionTitle
                    ? `action-title-${invalidActionTitleIds[0]}`
                    : gaps[0]?.targetId
                : lifecycle.stage === "set_commitment"
                  ? nextCommitmentTargetId
                  : `action-start-${primaryActionId || selectedActionIds[0]}`
            }
            onClick={() => {
              if (lifecycle.stage === "finish_report") {
                if (titleBlocked) {
                  focusLifecycleTarget("report-title");
                  return;
                }
                if (hasInvalidActionTitle) {
                  const target = document.getElementById(
                    `action-title-${invalidActionTitleIds[0]}`,
                  );
                  if (target instanceof HTMLElement) {
                    target.scrollIntoView({ behavior: "smooth", block: "center" });
                    focusEditableAtEnd(target);
                  }
                  return;
                }
                if (gaps[0]) focusGap(gaps[0]);
                return;
              }
              if (lifecycle.stage === "set_commitment") {
                focusLifecycleTarget(nextCommitmentTargetId);
                return;
              }
              if (lifecycle.stage === "start_action") {
                focusLifecycleTarget(
                  `action-start-${primaryActionId || selectedActionIds[0]}`,
                );
              }
            }}
          >
            {lifecycle.actionLabel}
          </button> : null}
      </div>
    </div>
  );
}
