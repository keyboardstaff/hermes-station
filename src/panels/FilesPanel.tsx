import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/i18n";
import { useThemeStore } from "@/store/app";
import { useFilesSelection } from "@/store/panel-selection";
import FilesSideTree from "@/components/files/FilesSideTree";
import FileEditor from "@/components/files/FileEditor";
import FileBreadcrumb from "@/components/files/FileBreadcrumb";
import PanelTwoColumn from "@/components/ui/PanelTwoColumn";
import PageTopBar from "@/components/layout/PageTopBar";

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
  const fromChat = (location.state as { from?: string } | null)?.from === "chat";

  const selected = useFilesSelection((s) => s.selected);
  const setSelected = useFilesSelection((s) => s.setSelected);

  const detail = (
    <div
      style={{
        padding: "var(--hms-space-6)",
        width: "100%",
        maxWidth: 1400,
        margin: "0 auto",
        boxSizing: "border-box",
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
        <div
          style={{
            padding: 32,
            border: "1px dashed var(--hms-border)",
            borderRadius: 8,
            textAlign: "center",
            color: "var(--hms-text-muted)",
            fontSize: "var(--hms-text-sm)",
          }}
        >
          {f.pickAFile}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <PageTopBar
        title={t.nav.files}
        leading={
          fromChat ? (
            <button
              type="button"
              onClick={() => navigate("/chat")}
              title={f.backToChat ?? "Back to chat"}
              aria-label={f.backToChat ?? "Back to chat"}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 30, height: 30, border: "none", borderRadius: 6,
                background: "transparent", color: "var(--hms-text-muted)", cursor: "pointer",
              }}
            >
              <ArrowLeft size={16} />
            </button>
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
