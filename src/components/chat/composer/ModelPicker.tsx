import { useEffect, useRef, useState } from "react";
import { Cpu, ChevronDown, Search, Check, Brain } from "lucide-react";
import type { ProviderInfo } from "@/hooks/useProviders";
import { useI18n } from "@/i18n";

// Provider-grouped model picker, extracted from Composer.
// Distinct from the Models page's ModelPickerDialog — this is the inline
// composer pill with live OpenRouter catalog search.
//
// Reasoning-effort lives HERE (absorbed from the old standalone ReasoningPicker)
// so thinking is chosen alongside the model — mirrors upstream desktop, where
// each model's menu carries its Thinking/Effort controls.

function providerConfigKey(p: ProviderInfo): string {
  return p.slug;
}

function modelLabel(m: string): string {
  return m.length > 36 ? m.slice(0, 34) + "…" : m;
}

// Effort levels match upstream hermes_constants.VALID_REASONING_EFFORTS. The
// Thinking toggle owns "none" (off); null = omit the field → upstream uses the
// config.yaml default (displayed as Medium). NEVER send "auto".
const EFFORT_OPTIONS = [
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Max" },
] as const;

/** Thinking is on unless explicitly "none" (null/empty = config default = on). */
function isThinkingOn(value: string | null): boolean {
  return (value ?? "medium").trim().toLowerCase() !== "none";
}

/** The effort radio's checked value — normalizes null/"none"/unknown → Medium. */
function normalizedEffort(value: string | null): string {
  const v = (value ?? "medium").trim().toLowerCase();
  if (v === "none") return "medium";
  return EFFORT_OPTIONS.some((o) => o.value === v) ? v : "medium";
}

/** Compact effort tag for the model pill suffix (Off when Thinking is disabled). */
function reasoningShort(value: string | null): string {
  if (!isThinkingOn(value)) return "Off";
  switch (normalizedEffort(value)) {
    case "minimal": return "Min";
    case "low": return "Low";
    case "high": return "High";
    case "xhigh": return "Max";
    default: return "Med";
  }
}

export function ModelPicker({
  value,
  providers,
  modelDefault,
  onChange,
  reasoningValue,
  onReasoningChange,
}: {
  value: string | null;
  providers: ProviderInfo[];
  modelDefault: string | null;
  onChange: (model: string, providerKey: string) => void;
  reasoningValue: string | null;
  onReasoningChange: (v: string | null) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Per-row hover flyout (Thinking + Effort), desktop-style. One shared flyout
  // (reasoning is session-global), bottom-flush with the model panel.
  const [effortFlyout, setEffortFlyout] = useState(false);
  const effortLeaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const catalogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [catalogModels, setCatalogModels] = useState<string[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        (!flyoutRef.current || !flyoutRef.current.contains(e.target as Node))
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setCatalogModels([]);
    }
  }, [open]);

  // Debounced OpenRouter full-catalog search (only when openrouter present + q≥2).
  useEffect(() => {
    if (catalogTimerRef.current) clearTimeout(catalogTimerRef.current);
    const hasOR = providers.some((p) => p.slug === "openrouter");
    const q = search.trim();
    if (!hasOR || q.length < 2) {
      setCatalogModels([]);
      return;
    }
    let cancelled = false;
    setCatalogLoading(true);
    catalogTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/models/openrouter-catalog?q=${encodeURIComponent(q)}`);
        if (res.ok && !cancelled) {
          const data = await res.json() as { models?: string[] };
          if (!cancelled) setCatalogModels(data.models ?? []);
        }
      } catch {
        /* best-effort */
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      if (catalogTimerRef.current) clearTimeout(catalogTimerRef.current);
    };
  }, [search, providers]);

  const handleOpen = () => {
    if (!open) {
      const rect = btnRef.current?.getBoundingClientRect();
      if (rect) {
        setPos({ top: rect.top, left: rect.left });
      }
    }
    setOpen((o) => !o);
  };

  // Pill = the selected model name (same modelLabel as the dropdown rows) + a
  // compact effort suffix (· Med / · Off). maxWidth lets it grow with the name.
  const baseLabel = value ? modelLabel(value) : (modelDefault ? modelLabel(modelDefault) : "model");
  const displayLabel = `${baseLabel} · ${reasoningShort(reasoningValue)}`;
  const searchQuery = search.trim().toLowerCase();
  const filteredProviders = providers
    .map((p) => {
      // Upstream can return entries with no/null models; coalesce so .filter doesn't crash.
      const models = Array.isArray(p.models) ? p.models : [];
      // Merge live OR catalog so search reaches beyond the curated built-in list.
      const merged = p.slug === "openrouter" && catalogModels.length > 0
        ? Array.from(new Set([...models, ...catalogModels]))
        : models;
      return {
        ...p,
        models: searchQuery
          ? merged.filter((m) => m.toLowerCase().includes(searchQuery))
          : models,
      };
    })
    .filter((p) => (searchQuery ? p.models.length > 0 : true));
  const hasSearchResults = filteredProviders.some((p) => p.models.length > 0);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={handleOpen}
        className="hms-mp-pill"
        data-set={value ? true : undefined}
        title={value ?? modelDefault ?? "Select model"}
      >
        <Cpu size={12} className="hms-mp-icon" />
        <span className="hms-mp-pill-label">{displayLabel}</span>
        <ChevronDown size={10} className="hms-mp-pill-chevron" />
      </button>

      {/* Fixed positioning escapes overflow:hidden parents. */}
      {open && (
        <div
          ref={panelRef}
          className="hms-popup-panel hms-mp-panel"
          style={{
            bottom: `${window.innerHeight - pos.top + 6}px`,
            left: Math.min(pos.left, window.innerWidth - 300) + "px",
          }}
        >
          <div className="hms-mp-search-wrap">
            <div className="hms-mp-search">
              <Search size={12} className="hms-mp-search-icon" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models"
                className="hms-mp-search-input"
              />
            </div>
          </div>

          <div className="hms-mp-list">
          {providers.length === 0 && (
            <div className="hms-mp-empty">No providers configured</div>
          )}
          {providers.length > 0 && !hasSearchResults && (
            <div className="hms-mp-empty">No matching models</div>
          )}
          {filteredProviders.map((p) => {
            const isCollapsed = collapsed[p.slug] ?? !p.models.includes(value ?? "");
            const isExpanded = searchQuery ? true : !isCollapsed;
            return (
              <div key={p.slug}>
                <div
                  onClick={() => setCollapsed((prev) => ({
                    ...prev,
                    [p.slug]: !(prev[p.slug] ?? !p.models.includes(value ?? "")),
                  }))}
                  className="hms-mp-prov-head"
                >
                  <span className="hms-mp-prov-name">
                    <ChevronDown size={11} className="hms-mp-prov-chevron" data-expanded={isExpanded || undefined} />
                    {p.name}
                    {p.slug === "openrouter" && catalogLoading && (
                      <span className="hms-spin hms-mp-spinner" />
                    )}
                    {p.is_user_defined ? (
                      <span className="hms-mp-badge hms-mp-badge--custom">Custom</span>
                    ) : (
                      <span className="hms-mp-badge hms-mp-badge--builtin">Built-in</span>
                    )}
                  </span>
                  <span className="hms-mp-prov-count">{p.models.length} model{p.models.length !== 1 ? "s" : ""}</span>
                </div>

                <div className={`hms-picker-models${isExpanded ? " expanded" : ""}`}>
                  {p.models.map((m) => {
                    const isSelected = (value ?? modelDefault) === m;
                    return (
                      <div
                        key={m}
                        onClick={() => {
                          onChange(m, providerConfigKey(p));
                          setOpen(false);
                        }}
                        className="hms-sidebar-row hms-mp-model"
                        data-active={isSelected}
                        onMouseEnter={() => {
                          if (effortLeaveRef.current) clearTimeout(effortLeaveRef.current);
                          setEffortFlyout(true);
                        }}
                        onMouseLeave={() => {
                          effortLeaveRef.current = setTimeout(() => setEffortFlyout(false), 160);
                        }}
                      >
                        <span className="hms-mp-model-label">{modelLabel(m)}</span>
                        <span className="hms-mp-model-meta">
                          {isSelected && <Check size={11} className="hms-mp-icon-success" />}
                          <Brain size={11} className="hms-mp-brain" />
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          </div>
        </div>
      )}

      {/* Per-row hover flyout: Thinking toggle + Effort radio (session-global).
          Bottom-flush with the model panel so the two line up. */}
      {open && effortFlyout && (
        <div
          ref={flyoutRef}
          onMouseEnter={() => { if (effortLeaveRef.current) clearTimeout(effortLeaveRef.current); }}
          onMouseLeave={() => setEffortFlyout(false)}
          className="hms-mp-flyout"
          style={{
            bottom: `${window.innerHeight - pos.top + 6}px`,
            left: effortFlyoutLeft(pos.left),
          }}
        >
          <div className="hms-mp-flyout-head">{t.composer.options}</div>
          <button
            type="button"
            onClick={() => onReasoningChange(isThinkingOn(reasoningValue) ? "none" : normalizedEffort(reasoningValue))}
            className="hms-mp-flyout-row"
          >
            <span className="hms-mp-flyout-label">
              <Brain size={12} className="hms-mp-icon" /> {t.composer.thinking}
            </span>
            <MiniSwitch on={isThinkingOn(reasoningValue)} />
          </button>
          <div className="hms-mp-divider" />
          <div className="hms-mp-flyout-head">{t.composer.effort}</div>
          {EFFORT_OPTIONS.map((opt) => {
            const checked = isThinkingOn(reasoningValue) && normalizedEffort(reasoningValue) === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onReasoningChange(opt.value)}
                className="hms-sidebar-row hms-mp-flyout-opt"
                data-active={checked}
              >
                {opt.label}
                {checked && <Check size={12} className="hms-mp-icon-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/** Flyout x-position: to the RIGHT of the model panel, flipping left near the edge. */
function effortFlyoutLeft(anchorLeft: number): number {
  const FLYOUT_W = 190;
  const panelLeft = Math.min(anchorLeft, window.innerWidth - 300);
  const rightSide = panelLeft + 300 + 6;
  return rightSide + FLYOUT_W <= window.innerWidth - 8 ? rightSide : panelLeft - FLYOUT_W - 6;
}

function MiniSwitch({ on }: { on: boolean }) {
  return (
    <span className="hms-mp-switch" data-on={on || undefined}>
      <span className="hms-mp-switch-knob" />
    </span>
  );
}
