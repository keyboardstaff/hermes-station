import { useEffect, useRef, useState } from "react";
import { Cpu, ChevronDown, Search, Check } from "lucide-react";
import type { ProviderInfo } from "@/hooks/useProviders";

// Provider-grouped model picker, extracted from Composer.
// Distinct from the Models page's ModelPickerDialog — this is the inline
// composer pill with live OpenRouter catalog search.

function providerConfigKey(p: ProviderInfo): string {
  return p.slug;
}

function modelLabel(m: string): string {
  return m.length > 36 ? m.slice(0, 34) + "…" : m;
}

export function ModelPicker({
  value,
  providers,
  modelDefault,
  onChange,
}: {
  value: string | null;
  providers: ProviderInfo[];
  modelDefault: string | null;
  onChange: (model: string, providerKey: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const catalogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [catalogModels, setCatalogModels] = useState<string[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
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

  const displayLabel = value ? modelLabel(value) : (modelDefault ? modelLabel(modelDefault) : "model");
  const panelMaxH = 340;
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
        style={{
          display: "inline-flex", alignItems: "center", gap: 'var(--hms-space-1)',
          padding: "2px 6px",
          borderRadius: 6,
          border: "1px solid var(--hms-border)",
          background: "var(--hms-surface)",
          color: value ? "var(--hms-text)" : "var(--hms-text-muted)",
          fontSize: 'var(--hms-text-caption)',
          cursor: "pointer",
          maxWidth: 160,
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
        title={value ?? modelDefault ?? "Select model"}
      >
        <Cpu size={12} style={{ flexShrink: 0 }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{displayLabel}</span>
        <ChevronDown size={10} style={{ color: "var(--hms-text-muted)", flexShrink: 0 }} />
      </button>

      {/* Fixed positioning escapes overflow:hidden parents. */}
      {open && (
        <div
          ref={panelRef}
          className="hms-popup-panel"
          style={{
            position: "fixed",
            bottom: `${window.innerHeight - pos.top + 6}px`,
            left: Math.min(pos.left, window.innerWidth - 300) + "px",
            width: 300,
            maxHeight: panelMaxH,
            overflowY: "auto",
            background: "var(--hms-surface)",
            border: "1px solid var(--hms-border)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
            zIndex: 9999,
            padding: "6px 0",
          }}
        >
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 1,
              padding: "0 10px 8px",
              background: "var(--hms-surface)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 'var(--hms-space-2)',
                border: "1px solid var(--hms-border)",
                borderRadius: 8,
                padding: "6px 8px",
                background: "var(--hms-bg)",
              }}
            >
              <Search size={12} style={{ color: "var(--hms-text-muted)", flexShrink: 0 }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models"
                style={{
                  width: "100%",
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  color: "var(--hms-text)",
                  fontSize: 'var(--hms-text-caption)',
                }}
              />
            </div>
          </div>

          {providers.length === 0 && (
            <div style={{ padding: "8px 14px", fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)" }}>
              No providers configured
            </div>
          )}
          {providers.length > 0 && !hasSearchResults && (
            <div style={{ padding: "8px 14px", fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)" }}>
              No matching models
            </div>
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
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "5px 12px",
                    cursor: "pointer",
                    userSelect: "none",
                    fontSize: 'var(--hms-text-xs)',
                    fontWeight: 600,
                    color: "var(--hms-text-muted)",
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-1)' }}>
                    <ChevronDown
                      size={11}
                      style={{
                        transition: "transform 240ms cubic-bezier(0.25, 0.1, 0.25, 1)",
                        transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)",
                      }}
                    />
                    {p.name}
                    {p.slug === "openrouter" && catalogLoading && (
                      <span className="hms-spin" style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", border: "1.5px solid var(--hms-text-muted)", borderTopColor: "var(--hms-text)", flexShrink: 0 }} />
                    )}
                    {p.is_user_defined ? (
                      <span style={{ fontSize: '0.5625rem', padding: "1px 4px", borderRadius: 3, background: "var(--hms-accent-weak)", color: "var(--hms-accent)", textTransform: "none", letterSpacing: 0 }}>
                        Custom
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.5625rem', padding: "1px 4px", borderRadius: 3, background: "color-mix(in srgb, var(--hms-info) 15%, transparent)", color: "var(--hms-info)", textTransform: "none", letterSpacing: 0 }}>
                        Built-in
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: '0.625rem', fontWeight: 400 }}>{p.models.length} model{p.models.length !== 1 ? "s" : ""}</span>
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
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "5px 12px 5px 28px",
                          cursor: "pointer",
                          fontSize: 'var(--hms-text-caption)',
                          color: isSelected ? "var(--hms-text)" : "var(--hms-text-muted)",
                          background: isSelected ? "var(--hms-selected-bg)" : "transparent",
                          transition: "background 120ms",
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--hms-hover-bg)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = isSelected ? "var(--hms-selected-bg)" : "transparent"; }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {modelLabel(m)}
                        </span>
                        {isSelected && <Check size={11} style={{ flexShrink: 0, color: "var(--hms-success)" }} />}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
