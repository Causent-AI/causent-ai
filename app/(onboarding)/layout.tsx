import { GlobalHeader } from "@/components/shell/GlobalHeader";
import { getSession } from "@/lib/auth/session";
import { listAccessibleDemoWorkspaces } from "@/lib/auth/workspace-context";
import { staticDemoWorkspaceOption } from "@/lib/auth/workspace-selection";
import { getServerSupabase } from "@/lib/supabase-server";

// Onboarding keeps its focused, tab-free main area while sharing the same global
// identity and account chrome as the rest of the application.

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const workspaces = process.env.CAUSENT_USE_SEED === "1"
    ? [staticDemoWorkspaceOption()]
    : await listAccessibleDemoWorkspaces(await getServerSupabase());
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg)]">
      <GlobalHeader activeWorkspaceId={session.workspaceId} workspaces={workspaces} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-4 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
