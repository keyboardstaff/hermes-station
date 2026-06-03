import { useEffect, useMemo, useState } from "react";
import { Trash2, Pencil, User, Play, Square } from "lucide-react";
import { useI18n } from "@/i18n";
import Button from "@/components/ui/Button";
import StatusDot from "@/components/ui/StatusDot";
import RenameProfileDialog from "@/components/profile/RenameProfileDialog";
import MarkdownDocEditor from "@/components/profile/MarkdownDocEditor";
import MemoryFacts from "@/components/profile/MemoryFacts";
import Personalities from "@/components/profile/Personalities";
import { useThemeStore } from "@/store/app";
import {
  useProfiles,
  useProfileSoul,
  useSetProfileSoul,
  useProfileMemory,
  useSetProfileMemory,
  useDeleteProfile,
  useStartProfileGateway,
  useStopProfileGateway,
  type ProfileInfo,
  type ProfileMemoryTab,
} from "@/hooks/useProfiles";
import { useProfileSelection } from "@/store/panel-selection";
import { errorMessage } from "@/lib/errors";
import ProfileSideList from "@/components/profile/ProfileSideList";
import PanelTwoColumn from "@/components/ui/PanelTwoColumn";
import PageTopBar from "@/components/layout/PageTopBar";

/**
 * Profile page. Owns its own list↔detail layout via PanelTwoColumn. Each
 * profile is its own HERMES_HOME, so the detail surfaces that profile's
 * own docs as tabs: Overview / SOUL.md / Personality / USER.md / MEMORY.md /
 * Memory store (the markdown docs, the personality overlays, and the structured
 * holographic memory store all live here, per-profile — no top-level pages).
 */

// Tab order: persona (SOUL base + Personality overlays) → the memory layering
// (USER model → the agent's accumulated MEMORY notes → the structured store).
type ProfileDocTab = "soul" | "personality" | "user" | "memory" | "store";

export default function ProfilePanel() {
  const { t } = useI18n();
  const pf = t.profile;

  const { data, isLoading } = useProfiles();
  const profiles = useMemo(() => data?.profiles ?? [], [data]);

  const selectedName = useProfileSelection((s) => s.selectedName);
  const setSelected = useProfileSelection((s) => s.setSelected);

  // Auto-select default when nothing is selected and data lands. Kept here
  // (in addition to ProfileSideList) so a direct navigate to ``/profile``
  // lands on the default even before the side list has rendered.
  useEffect(() => {
    if (selectedName || profiles.length === 0) return;
    const def = profiles.find((p) => p.is_default) ?? profiles[0];
    setSelected(def.name);
  }, [profiles, selectedName, setSelected]);

  const selected = profiles.find((p) => p.name === selectedName) ?? null;

  let detail: React.ReactNode;
  if (isLoading) {
    detail = (
      <div style={mainShell}>
        <div style={{ padding: 32, fontSize: "var(--hms-text-sm)", color: "var(--hms-text-muted)" }}>
          {pf?.loading ?? "Loading…"}
        </div>
      </div>
    );
  } else if (!selected) {
    detail = (
      <div style={mainShell}>
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
          {pf?.selectAProfile ?? "Select a profile."}
        </div>
      </div>
    );
  } else {
    detail = (
      <div style={mainShell}>
        <ProfileDetail profile={selected} pf={pf} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <PageTopBar title={t.nav.profile} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <PanelTwoColumn
          list={<ProfileSideList />}
          detail={detail}
          hasSelection={selectedName !== null}
          onBack={() => setSelected(null)}
          storageKey="profile"
        />
      </div>
    </div>
  );
}

// ── Detail: Overview section + document tabs ─────────────────────────

const DOC_TABS: { id: ProfileDocTab; label: string }[] = [
  { id: "soul", label: "SOUL.md" },
  { id: "personality", label: "Personality" },
  { id: "user", label: "USER.md" },
  { id: "memory", label: "MEMORY.md" },
  { id: "store", label: "Memory store" },
];

function ProfileDetail({ profile, pf }: { profile: ProfileInfo; pf: ReturnType<typeof useI18n>["t"]["profile"] }) {
  const { resolvedTheme } = useThemeStore();
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "vs";
  const [tab, setTab] = useState<ProfileDocTab>("soul");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--hms-space-4)", flex: 1, minHeight: 0 }}>
      <div>
        <h2
          style={{
            margin: 0,
            fontSize: "var(--hms-text-lg)",
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: "var(--hms-space-2)",
          }}
        >
          <User size={16} style={{ color: profile.is_default ? "var(--hms-accent)" : "#94a3b8" }} />
          {profile.name}
          {profile.is_default && (
            <span
              style={{
                fontSize: "0.625rem",
                padding: "2px 6px",
                borderRadius: 4,
                background: "rgba(99,102,241,0.12)",
                color: "#4f46e5",
                fontWeight: 600,
              }}
            >
              {pf?.defaultBadge ?? "default"}
            </span>
          )}
        </h2>
        {profile.distribution_name && (
          <p style={{ margin: "6px 0 0", fontSize: "var(--hms-text-xs)", color: "var(--hms-text-muted)" }}>
            {pf?.distributionLabel ?? "Distribution"}: <code>{profile.distribution_name}</code>
            {profile.distribution_version && <span> v{profile.distribution_version}</span>}
            {profile.distribution_source && <span> · {profile.distribution_source}</span>}
          </p>
        )}
      </div>

      {/* Overview — standalone section, always visible */}
      <OverviewTab profile={profile} pf={pf} />

      {/* Document tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--hms-border)" }}>
        {DOC_TABS.map((tb) => (
          <button
            key={tb.id}
            type="button"
            onClick={() => setTab(tb.id)}
            style={{
              padding: "8px 16px",
              fontSize: "var(--hms-text-sm)",
              fontWeight: 500,
              border: "none",
              background: "transparent",
              color: tab === tb.id ? "var(--hms-text)" : "var(--hms-text-muted)",
              borderBottom: tab === tb.id ? "2px solid var(--hms-accent, #5c6bc0)" : "2px solid transparent",
              cursor: "pointer",
              marginBottom: -1,
            }}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === "soul" ? (
        <SoulTab name={profile.name} monacoTheme={monacoTheme} />
      ) : tab === "personality" ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <Personalities profile={profile.name} />
        </div>
      ) : tab === "store" ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <MemoryFacts profile={profile.name} />
        </div>
      ) : (
        <MemoryTab name={profile.name} tab={tab} monacoTheme={monacoTheme} />
      )}
    </div>
  );
}

// ── Overview tab: meta card + rename/delete ──────────────────────────

function OverviewTab({ profile, pf }: { profile: ProfileInfo; pf: ReturnType<typeof useI18n>["t"]["profile"] }) {
  const del = useDeleteProfile();
  const startGw = useStartProfileGateway();
  const stopGw = useStopProfileGateway();
  const setSelected = useProfileSelection((s) => s.setSelected);
  const [renameOpen, setRenameOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const gwPending = startGw.isPending || stopGw.isPending;

  const handleDelete = async () => {
    if (profile.is_default) return;
    if (!window.confirm(`${pf?.confirmDelete ?? "Delete profile"} ${profile.name}?`)) return;
    try {
      await del.mutateAsync(profile.name);
      setSelected(null);
    } catch (e: unknown) {
      setErr(errorMessage(e));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--hms-space-4)", maxWidth: "var(--hms-content-max-w, 72ch)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-2)", flexWrap: "wrap" }}>
        <StatusDot
          tone={profile.gateway_running ? "success" : "muted"}
          filled={profile.gateway_running}
          label={profile.gateway_running ? (pf?.running ?? "running") : (pf?.stopped ?? "stopped")}
        />
        {profile.gateway_running ? (
          <Button size="sm" onClick={() => stopGw.mutate(profile.name)} disabled={gwPending}>
            <Square size={11} /> {pf?.stopGateway ?? "Stop"}
          </Button>
        ) : (
          <Button size="sm" onClick={() => startGw.mutate(profile.name)} disabled={gwPending}>
            <Play size={11} /> {pf?.startGateway ?? "Start"}
          </Button>
        )}
        <div style={{ flex: 1 }} />
        <Button size="sm" onClick={() => setRenameOpen(true)}>
          <Pencil size={12} />
          {pf?.rename ?? "Rename"}
        </Button>
        {!profile.is_default && (
          <Button size="sm" variant="danger" onClick={handleDelete} disabled={del.isPending}>
            <Trash2 size={12} />
            {pf?.delete ?? "Delete"}
          </Button>
        )}
      </div>
      <RenameProfileDialog
        open={renameOpen}
        currentName={profile.name}
        onClose={() => setRenameOpen(false)}
        onRenamed={(newName) => setSelected(newName)}
      />

      <div
        style={{
          padding: 14,
          border: "1px solid var(--hms-border)",
          borderRadius: 10,
          background: "var(--hms-surface)",
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          rowGap: 8,
          columnGap: 12,
          fontSize: "var(--hms-text-caption)",
        }}
      >
        <span style={metaLabel}>{pf?.path ?? "Path"}</span>
        <span style={{ fontFamily: "monospace", fontSize: "var(--hms-text-xs)", wordBreak: "break-all", color: "var(--hms-text-muted)" }}>
          {profile.path}
        </span>
        {profile.model && (
          <>
            <span style={metaLabel}>{pf?.model ?? "Model"}</span>
            <span style={{ fontFamily: "monospace" }}>{profile.model}</span>
          </>
        )}
        {profile.provider && (
          <>
            <span style={metaLabel}>{pf?.provider ?? "Provider"}</span>
            <span style={{ fontFamily: "monospace" }}>{profile.provider}</span>
          </>
        )}
        <span style={metaLabel}>{pf?.skillCount ?? "Skills"}</span>
        <span>{profile.skill_count}</span>
        <span style={metaLabel}>{pf?.gateway ?? "Gateway"}</span>
        <span>
          {profile.gateway_running ? (
            <span style={{ color: "var(--hms-success-text)" }}>● {pf?.running ?? "running"}</span>
          ) : (
            <span style={{ color: "var(--hms-text-muted)" }}>○ {pf?.stopped ?? "stopped"}</span>
          )}
        </span>
      </div>

      {err && (
        <div style={{ padding: "6px 10px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.18)", borderRadius: 6, color: "var(--hms-error-text)", fontSize: "var(--hms-text-caption)" }}>
          {err}
        </div>
      )}
    </div>
  );
}

// ── Doc tabs ─────────────────────────────────────────────────────────

function SoulTab({ name, monacoTheme }: { name: string; monacoTheme: string }) {
  const soulQuery = useProfileSoul(name);
  const setSoul = useSetProfileSoul();
  return (
    <MarkdownDocEditor
      label="SOUL.md"
      content={soulQuery.data?.content ?? ""}
      isLoading={soulQuery.isLoading}
      isSaving={setSoul.isPending}
      monacoTheme={monacoTheme}
      onSave={(content) => setSoul.mutateAsync({ name, content }).then(() => undefined)}
    />
  );
}

function MemoryTab({ name, tab, monacoTheme }: { name: string; tab: ProfileMemoryTab; monacoTheme: string }) {
  const memQuery = useProfileMemory(name, tab);
  const setMem = useSetProfileMemory();
  const label = tab === "memory" ? "MEMORY.md" : "USER.md";
  const pathHint = `${tab === "memory" ? "memories/MEMORY.md" : "memories/USER.md"}`;
  return (
    <MarkdownDocEditor
      key={tab}
      label={label}
      pathHint={pathHint}
      content={memQuery.data?.content ?? ""}
      isLoading={memQuery.isLoading}
      isSaving={setMem.isPending}
      monacoTheme={monacoTheme}
      onSave={(content) => setMem.mutateAsync({ name, tab, content }).then(() => undefined)}
    />
  );
}

// ── Styles ───────────────────────────────────────────────────────────

const mainShell: React.CSSProperties = {
  padding: "var(--hms-space-6)",
  width: "100%",
  height: "100%",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
};

const metaLabel: React.CSSProperties = {
  fontSize: "0.625rem",
  fontWeight: 600,
  color: "var(--hms-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  whiteSpace: "nowrap",
};
