import { GlobalHeader } from "@/components/shell/GlobalHeader";

// Onboarding keeps its focused, tab-free main area while sharing the same global
// identity and account chrome as the rest of the application.

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg)]">
      <GlobalHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-4 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
