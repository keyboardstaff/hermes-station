import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import { useI18n } from "@/i18n";
import { useThemeStore } from "@/store/app";
import { useFilesSelection } from "@/store/panel-selection";
import FilesSideTree from "@/components/files/FilesSideTree";
import FileEditor from "@/components/files/FileEditor";
import FileBreadcrumb from "@/components/files/FileBreadcrumb";
import PanelTwoColumn from "@/components/ui/PanelTwoColumn";
import PageTopBar from "@/components/layout/PageTopBar";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

/**
 * Files page. Owns its own list↔detail layout via PanelTwoColumn —
 * the global SidePanel slot is retired. Selection state lives in the
 * ``useFilesSelection`` zustand store.
 *
 * The editor & version-history widgets live in `src/components/files/`
 * so the chat `WorkspaceContextPanel` can reuse them (drawer mode renders
 * them inside a single-column slide-over, this page renders them in
 * the two-column desktop layout).
 */
export default function FilesPanel() {
  const { t } = useI18n();
  const f = t.files;
  const { resolvedTheme } = useThemeStore();
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "vs";
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const backTarget = from === "chat" ? "/chat" : from === "artifacts" ? "/artifacts" : null;
  const backLabel = from === "artifacts" ? t.nav.artifacts : t.nav.chat;

  const selected = useFilesSelection((s) => s.selected);
  const setSelected = useFilesSelection((s) => s.setSelected);

  const detail = (
    <div
      style={{
        padding: "var(--hms-space-4)",
        width: "100%",
        boxSizing: "border-box",
        height: "100%",
        minHeight: 0,
        display: "flex",
      }}
    >
      {selected ? (
        <FileEditor
          key={`${selected.root}:${selected.path}`}
          root={selected.root}
          path={selected.path}
          monacoTheme={monacoTheme}
          onAfterDelete={() => setSelected(null)}
        />
      ) : (
        <Card
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 'var(--hms-space-3)',
            textAlign: "center",
            color: "var(--hms-text-muted)",
            fontSize: "var(--hms-text-sm)",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--hms-hover-bg)",
              color: "var(--hms-text)",
            }}
          >
            <FileText size={24} />
          </div>
          {f.pickAFile}
        </Card>
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <PageTopBar
        title={t.nav.files}
        actions={
          backTarget ? (
            <Button
              size="sm"
              onClick={() => navigate(backTarget)}
              title={f.backToChat ?? "Back"}
            >
              <ArrowLeft size={14} /> {backLabel}
            </Button>
          ) : undefined
        }
      />
      <div style={{ flex: 1, minHeight: 0 }}>
        <PanelTwoColumn
          list={<FilesSideTree />}
          detail={detail}
          hasSelection={selected !== null}
          onBack={() => setSelected(null)}
          storageKey="files"
          mobileBackBar={
            selected ? (
              <FileBreadcrumb
                root={selected.root}
                path={selected.path}
                onBack={() => setSelected(null)}
              />
            ) : undefined
          }
        />
      </div>
    </div>
  );
}
