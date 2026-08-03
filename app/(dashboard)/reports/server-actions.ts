"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { deleteDecisionReport, startDecisionReportIteration } from "@/lib/decision-reports/persistence";
import { getServerSupabase, isLocalDemo } from "@/lib/supabase-server";

export type DeleteReportActionState =
  | { status: "idle" }
  | { status: "error"; error: string };

export type StartIterationActionState =
  | { status: "idle" }
  | { status: "error"; error: string }
  | { status: "created"; reportId: string };

export async function startDecisionReportIterationAction(
  _previous: StartIterationActionState,
  formData: FormData,
): Promise<StartIterationActionState> {
  const session = await getSession();
  if (!isLocalDemo() && !session.userId) return { status: "error", error: "Sign in before starting an iteration." };
  const parentId = formData.get("parentReportId");
  const reason = formData.get("reason");
  if (typeof parentId !== "string" || typeof reason !== "string") return { status: "error", error: "Iteration details are invalid." };
  const result = await startDecisionReportIteration(await getServerSupabase(), session.workspaceId, parentId, reason, session.userId);
  if (!result.ok) return { status: "error", error: result.error };
  revalidatePath("/reports");
  revalidatePath("/onboarding");
  return { status: "created", reportId: result.reportId };
}

export async function deleteDecisionReportAction(
  _previous: DeleteReportActionState,
  formData: FormData,
): Promise<DeleteReportActionState> {
  const session = await getSession();
  if (!isLocalDemo() && !session.userId) {
    return { status: "error", error: "Sign in before deleting a report." };
  }
  const reportId = formData.get("reportId");
  if (typeof reportId !== "string") {
    return { status: "error", error: "Choose a valid report." };
  }
  const result = await deleteDecisionReport(
    await getServerSupabase(),
    session.workspaceId,
    reportId,
    session.userId,
  );
  if (!result.ok) return { status: "error", error: result.error };

  revalidatePath("/reports");
  revalidatePath("/onboarding");
  revalidatePath("/", "layout");
  return { status: "idle" };
}
