import { Suspense, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "@/components/layout/Sidebar";
import { ErrorBoundary } from "@/components/layout/ErrorBoundary";
import { ROUTES, DEFAULT_ROUTE } from "@/routes/registry";

/**
 * Desktop shell. Just the Sidebar + the routed main pane — the legacy
 * global SidePanel slot and CapabilityBadge are gone in P2b. Each
 * Panel owns its own list↔detail layout via <PanelTwoColumn> now.
 */
export default function DesktopShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="hms-layout">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
      />

      <main className="hms-main">
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Navigate to={DEFAULT_ROUTE} replace />} />
            {/* Back-compat: the Agents page moved from /group → /agents. */}
            <Route path="/group" element={<Navigate to="/agents" replace />} />
            {ROUTES.map(({ path, labelKey, panel: Panel }) => (
              <Route
                key={path}
                path={path}
                element={
                  <ErrorBoundary label={labelKey}>
                    <Panel />
                  </ErrorBoundary>
                }
              />
            ))}
            <Route path="*" element={<Navigate to={DEFAULT_ROUTE} replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
