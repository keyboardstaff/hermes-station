import { useEffect, useRef, useState, useCallback } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { FileText, RotateCw, Save, AlertCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useThemeStore } from "@/store/app";
import { useI18n } from "@/i18n";

/**
 * in-station editor for ``~/.hermes/config.yaml``.
 *
 * UX:
 *   - Loads the raw text via ``GET /api/config/yaml`` along with a
 *     sha256 digest the SPA echoes back on save.
 *   - The Save button posts ``{yaml_text, expected_sha256}`` to
 *     ``PUT /api/config/yaml``. The backend forwards to upstream's
 *     ``PUT /api/dashboard/config/raw`` which validates YAML syntax
 *     (HTTP 400 with line info on parse error) and persists with
 *     comment preservation.
 *   - 409 from the backend means another writer modified the file
 *     between our load and save — we surface that as a "reload to
 *     pick up changes" prompt and refuse the overwrite.
 *
 * The Monaco editor's YAML language ships with the package's default
 * languages bundle — no extra worker setup required. We pass the
 * current theme (light/dark) so the editor matches the rest of the
 * station chrome.
 */
interface RawDoc {
  yaml: string;
  sha256: string;
  mtime: number;
  path: string;
}

export default function ConfigYamlEditor({ profile }: { profile?: string }) {
  const { t } = useI18n();
  const { resolvedTheme } = useThemeStore();

  const [doc, setDoc] = useState<RawDoc | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** UI status — null = nothing recent, then transient ok/conflict/error. */
  const [status, setStatus] = useState<
    | null
    | { kind: "saved"; message: string }
    | { kind: "conflict"; currentSha: string }
    | { kind: "error"; message: string }
  >(null);
  const editorRef = useRef<unknown>(null);

  // Profile-scoped when a profile is given (Advanced tab → that profile's
  // HERMES_HOME/config.yaml); else the active config via the dashboard path.
  const endpoint = profile
    ? `/api/profiles/${encodeURIComponent(profile)}/config`
    : "/api/config/yaml";

  const load = useCallback(async () => {
    setLoading(true);
    setStatus(null);
    try {
      const r = await api.get<RawDoc>(endpoint);
      setDoc(r);
      setDraft(r.yaml);
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : "load failed" });
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => { void load(); }, [load]);

  const dirty = doc !== null && draft !== doc.yaml;

  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  const onSave = async () => {
    if (!doc || saving) return;
    setSaving(true);
    setStatus(null);
    try {
      await api.json<{ ok?: boolean }>(endpoint, "PUT", {
        yaml_text: draft,
        expected_sha256: doc.sha256,
      });
      // Refetch — pulls the new sha256 so a subsequent save doesn't
      // 409 itself. Cheap (filesystem read), so worth it.
      await load();
      setStatus({
        kind: "saved",
        message: t.config.saved,
      });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 409) {
          const detail = e.detail as { current_sha256?: string } | undefined;
          setStatus({ kind: "conflict", currentSha: detail?.current_sha256 ?? "" });
        } else if (e.status === 400) {
          // Upstream returns {detail: "Invalid YAML: ..."} — surface verbatim.
          setStatus({ kind: "error", message: e.message });
        } else if (e.status === 503) {
          setStatus({
            kind: "error",
            message: t.config.upstreamUnreachable,
          });
        } else {
          setStatus({ kind: "error", message: e.message });
        }
      } else {
        setStatus({ kind: "error", message: e instanceof Error ? e.message : "save failed" });
      }
    } finally {
      setSaving(false);
    }
  };

  const onDiscard = () => {
    if (!doc) return;
    setDraft(doc.yaml);
    setStatus(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-3)', flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)' }}>
        <FileText size={14} style={{ flexShrink: 0 }} />
        <code style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)" }}>
          {doc?.path ?? "~/.hermes/config.yaml"}
        </code>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || saving}
          title={t.config.reload}
          style={iconButtonStyle(loading || saving)}
        >
          <RotateCw size={14} />
        </button>
      </div>

      {/* Editor — Monaco's chrome is tuned to match the site:
          • Tight 4 px scrollbar (matches ``::-webkit-scrollbar`` in
            theme.css; sidebar bars and SessionRecents scroll already use
            this dimension).
          • Narrow line-number gutter (3 char digits + 4 px padding —
            saves ~28 px of horizontal real estate vs. the default).
          • Loading hint while the lazy chunk + worker boot. We also
            pre-mark ``preventCloseSession=true`` so the model is kept
            warm if the user navigates away and back. */}
      <div style={{
        border: "1px solid var(--hms-border)",
        borderRadius: 8,
        overflow: "hidden",
        flex: 1,
        minHeight: 200,
      }}>
        <Editor
          language="yaml"
          theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
          value={loading ? "# loading…" : draft}
          onChange={(v) => setDraft(v ?? "")}
          onMount={onMount}
          loading={
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              fontSize: 'var(--hms-text-caption)',
              color: "var(--hms-text-muted)",
              fontFamily: "monospace",
            }}>
              {t.config.idleHint}
            </div>
          }
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            lineNumbersMinChars: 3,
            lineDecorationsWidth: 4,
            glyphMargin: false,
            folding: false,
            scrollBeyondLastLine: false,
            tabSize: 2,
            wordWrap: "on",
            // Disable suggestion popups — YAML completion is noise here.
            quickSuggestions: false,
            renderLineHighlight: "line",
            // Lightweight scrollbar that visually matches the rest of
            // the station (4 px, thumb tinted like ``--hms-border``).
            scrollbar: {
              vertical: "auto",
              horizontal: "auto",
              verticalScrollbarSize: 4,
              horizontalScrollbarSize: 4,
              verticalSliderSize: 4,
              horizontalSliderSize: 4,
              useShadows: false,
            },
            overviewRulerLanes: 0,
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            // Avoid heavy semantic validation on a YAML file we just
            // serialise as text — speeds up first-paint by skipping
            // worker bring-up of the Monaco language service.
            occurrencesHighlight: "off",
          }}
        />
      </div>

      {/* Status row + actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)', fontSize: 'var(--hms-text-caption)'}}>
        <StatusLine status={status} dirty={dirty} t={t} />
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onDiscard}
          disabled={!dirty || saving}
          style={discardButtonStyle(!dirty || saving)}
        >
          {t.config.discard}
        </button>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={!dirty || saving}
          style={saveButtonStyle(!dirty || saving)}
        >
          <Save size={13} />
          {saving ? t.config.saving : t.config.save}
        </button>
      </div>
    </div>
  );
}

// ── inline helpers ────────────────────────────────────────────────────

function StatusLine({
  status,
  dirty,
  t,
}: {
  status: StatusKind;
  dirty: boolean;
  t: ReturnType<typeof useI18n>["t"];
}) {
  if (status?.kind === "conflict") {
    return (
      <span style={{ color: "var(--hms-error-text)", display: "flex", alignItems: "center", gap: 'var(--hms-space-1)' }}>
        <AlertCircle size={12} />
        {t.config.conflict}
      </span>
    );
  }
  if (status?.kind === "error") {
    return (
      <span style={{ color: "var(--hms-error-text)", display: "flex", alignItems: "center", gap: 'var(--hms-space-1)' }}>
        <AlertCircle size={12} />
        {status.message}
      </span>
    );
  }
  if (status?.kind === "saved") {
    return <span style={{ color: "var(--hms-success-text)" }}>{status.message}</span>;
  }
  if (dirty) {
    return <span style={{ color: "var(--hms-text-muted)" }}>{t.config.unsavedHint}</span>;
  }
  return <span style={{ color: "var(--hms-text-muted)" }}>{t.config.idleHint}</span>;
}

type StatusKind =
  | { kind: "saved"; message: string }
  | { kind: "conflict"; currentSha: string }
  | { kind: "error"; message: string }
  | null;

function iconButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    width: 28, height: 28,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    border: "1px solid var(--hms-border)", borderRadius: 6,
    background: "var(--hms-surface)", color: "var(--hms-text)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

// Shared dimensions so Save and Discard line up perfectly. Save carries
// an icon, so we use ``display: inline-flex`` + an explicit height to
// keep both pills the same vertical size regardless of icon presence.
const _BTN_HEIGHT = 30;
const _BTN_BASE: React.CSSProperties = {
  height: _BTN_HEIGHT,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 14px",
  borderRadius: 6,
  fontSize: 'var(--hms-text-caption)',
  lineHeight: 1,
  boxSizing: "border-box",
};

function saveButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    ..._BTN_BASE,
    border: "1px solid var(--hms-accent)",
    background: disabled ? "var(--hms-surface)" : "var(--hms-accent)",
    color: disabled ? "var(--hms-text-muted)" : "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 500,
    gap: 'var(--hms-space-2)',
  };
}

function discardButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    ..._BTN_BASE,
    border: "1px solid var(--hms-border)",
    background: "var(--hms-surface)",
    color: disabled ? "var(--hms-text-muted)" : "var(--hms-text)",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
