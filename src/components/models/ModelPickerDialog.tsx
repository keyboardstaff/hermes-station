/**
 * shared modal dialog for selecting a provider+model.
 *
 * Used by Primary, Auxiliary, and Fallback tabs of ``ModelsPanel`` to
 * pick a (provider, model) pair from the authenticated providers list.
 * Grouped by provider, searchable, keyboard-friendly.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Search, ChevronDown, ChevronRight, CheckCircle } from "lucide-react";
import type { ProviderInfo } from "@/hooks/useProviders";

interface Props {
  open: boolean;
  onClose: () => void;
  providers: ProviderInfo[];
  /** Currently selected ``model`` string — highlighted in the list. */
  currentModel?: string | null;
  /** Allows the picker to indicate "Auto-detect" (provider="auto"). */
  allowAuto?: boolean;
  /** Title shown at the top of the dialog. */
  title: string;
  /** ``(provider, model)`` callback. ``provider`` may be ``"auto"``. */
  onSelect: (provider: string, model: string) => void;
  /** Labels — fall back to English. */
  labels: {
    searchPlaceholder: string;
    noResults: string;
    auto: string;
    autoHint: string;
    close: string;
  };
}

export default function ModelPickerDialog({
  open,
  onClose,
  providers,
  currentModel,
  allowAuto,
  title,
  onSelect,
  labels,
}: Props) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSearch("");
      setCollapsed({});
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    return providers
      .map((p) => {
        const models = Array.isArray(p.models) ? p.models : [];
        return {
          ...p,
          models: q ? models.filter((m) => m.toLowerCase().includes(q)) : models,
        };
      })
      .filter((p) => (q ? p.models.length > 0 : true));
  }, [providers, q]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 'var(--hms-space-4)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 600,
          maxHeight: "85vh",
          background: "var(--hms-surface)",
          border: "1px solid var(--hms-border)",
          borderRadius: 12,
          boxShadow: "0 20px 40px rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "14px 16px",
            borderBottom: "1px solid var(--hms-border)",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 'var(--hms-text-base)', fontWeight: 600 }}>{title}</h3>
          <button
            onClick={onClose}
            aria-label={labels.close}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: 6,
              border: "none",
              background: "transparent",
              color: "var(--hms-text-muted)",
              cursor: "pointer",
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--hms-border)" }}>
          <div style={{ position: "relative" }}>
            <Search
              size={14}
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--hms-text-muted)",
              }}
            />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={labels.searchPlaceholder}
              style={{
                width: "100%",
                padding: "8px 10px 8px 32px",
                fontSize: 'var(--hms-text-sm)',
                background: "var(--hms-bg)",
                border: "1px solid var(--hms-border)",
                borderRadius: 6,
                color: "var(--hms-text)",
                outline: "none",
              }}
            />
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: "auto", padding: 'var(--hms-space-2)' }}>
          {/* Auto option */}
          {allowAuto && !q && (
            <button
              onClick={() => onSelect("auto", "")}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--hms-border)",
                background: "transparent",
                color: "var(--hms-text)",
                cursor: "pointer",
                marginBottom: 8,
              }}
            >
              <div style={{ fontSize: 'var(--hms-text-sm)', fontWeight: 600 }}>{labels.auto}</div>
              <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)", marginTop: 2 }}>
                {labels.autoHint}
              </div>
            </button>
          )}

          {filtered.length === 0 ? (
            <div
              style={{
                padding: 32,
                textAlign: "center",
                color: "var(--hms-text-muted)",
                fontSize: 'var(--hms-text-sm)',
              }}
            >
              {labels.noResults}
            </div>
          ) : (
            filtered.map((p) => {
              const isCollapsed = collapsed[p.slug] === true;
              return (
                <div key={p.slug} style={{ marginBottom: 6 }}>
                  <button
                    onClick={() =>
                      setCollapsed((c) => ({ ...c, [p.slug]: !isCollapsed }))
                    }
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 'var(--hms-space-2)',
                      width: "100%",
                      padding: "6px 8px",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      fontSize: 'var(--hms-text-xs)',
                      fontWeight: 600,
                      color: "var(--hms-text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      textAlign: "left",
                    }}
                  >
                    {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    {p.name || p.slug}
                    <span style={{ marginLeft: "auto", fontWeight: 400, fontSize: '0.625rem'}}>
                      {p.models.length}
                    </span>
                  </button>

                  {!isCollapsed &&
                    p.models.map((m) => {
                      const isCurrent = m === currentModel;
                      return (
                        <button
                          key={`${p.slug}/${m}`}
                          onClick={() => onSelect(p.slug, m)}
                          className="hms-sidebar-row"
                          data-active={isCurrent}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 'var(--hms-space-2)',
                            width: "100%",
                            padding: "6px 12px 6px 28px",
                            border: "none",
                            color: isCurrent ? "var(--hms-text)" : "var(--hms-text)",
                            cursor: "pointer",
                            fontSize: 'var(--hms-text-caption)',
                            fontFamily: "monospace",
                            textAlign: "left",
                            borderRadius: 6,
                          }}
                        >
                          {isCurrent && (
                            <CheckCircle size={12} style={{ color: "var(--hms-accent)", flexShrink: 0 }} />
                          )}
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {m}
                          </span>
                        </button>
                      );
                    })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
