import { GlobalHeader } from "@/components/shell/GlobalHeader";
import { TabStrip } from "@/components/shell/TabStrip";
import { CoreMetricsDrawer } from "@/components/shell/CoreMetricsDrawer";

// Persistent shell: global header + tab strip on top, the active tab in the
// scrolling middle, and the Core Metrics drawer pinned to the bottom on every tab.

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg)]">
      <GlobalHeader />
      <TabStrip />
      <main className="scroll-slim min-h-0 flex-1 overflow-y-auto">{children}</main>
      <CoreMetricsDrawer />
    </div>
  );
}
