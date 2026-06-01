import { Suspense, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Drawer from "./Drawer";
import Sidebar from "./Sidebar";
import { ErrorBoundary } from "@/components/layout/ErrorBoundary";
import { useVisualViewport } from "@/hooks/useVisualViewport";
import { useEdgeSwipe } from "@/hooks/useEdgeSwipe";
import { ROUTES, DEFAULT_ROUTE } from "@/routes/registry";
import { useI18n } from "@/i18n";
import { Menu } from "lucide-react";

/**
 * Mobile shell. Just a Drawer-mounted Sidebar + the routed main pane.
 *
 * MobileHeader is gone — the hamburger button now needs to
 * live inside an in-panel header, but as a transitional measure (until
 * each Panel grows its own header) we render a thin floating hamburger
 * that opens the Drawer. Each Panel's PanelTwoColumn handles its own
 * list↔detail flow on mobile (no shell wrapper required).
 *
 * onOpenSearch is accepted so AppShell's signature doesn't change; ⌘K
 * remains the only entry point and AppShell catches it globally.
 */
export default function MobileShell({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onOpenSearch,
}: {
  onOpenSearch: () => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { t } = useI18n();
  const location = useLocation();
  const currentRoute = ROUTES.find(r => location.pathname.startsWith(r.path));
  const pageTitle = currentRoute ? t.nav[currentRoute.labelKey] : "";

  useVisualViewport();
  useEdgeSwipe(() => setDrawerOpen(true));

  return (
    <div className="hms-mobile-shell">
      <header className="hms-mobile-header">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label={t.nav.openDrawer}
        >
          <Menu size={18} />
        </button>
        <span className="hms-mobile-header-title">{pageTitle}</span>
      </header>

      <main className="hms-mobile-main">
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Navigate to={DEFAULT_ROUTE} replace />} />
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

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        ariaLabel={t.nav.drawerLabel}
      >
        <Sidebar mobile onNavigate={() => setDrawerOpen(false)} recentsLimit={20} />
      </Drawer>
    </div>
  );
}
