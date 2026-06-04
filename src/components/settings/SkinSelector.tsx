import { useSkinStore } from "@/store/app";
import { SKINS, type Skin } from "@/styles/skins";
import { useI18n } from "@/i18n";

/**
 * SkinSelector.
 *
 * Renders one chip per station-owned skin (8 total, starting with
 * "Default"). Each chip shows three accent-coloured dots above the
 * name so the user can preview the personality before committing.
 *
 * Selection is live: clicking a chip calls `useSkinStore.setSkin` which
 * writes `<html data-skin="<name>">` and the cascade in
 * `skin-bridge.css` re-derives `--hms-accent` / `--hms-surface` from
 * there. No reload, no DOM tree thrashing — just CSS-variable
 * propagation across the entire UI.
 *
 * The screenshot in PR feedback shows a 4-column grid; we honour that
 * via `grid-template-columns: repeat(4, 1fr)` and let chips wrap on
 * narrower viewports. The mobilevariant of this picker can
 * collapse the grid to 2 columns via a media query — no JS change
 * required because the structure is purely CSS-driven.
 */
export default function SkinSelector() {
  const { t } = useI18n();
  const { skin, setSkin } = useSkinStore();

  return (
    <div>
      <div style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)", marginBottom: 8 }}>
        {t.skin.sectionLabel}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 'var(--hms-space-2)',
        }}
      >
        {SKINS.map((sk) => (
          <SkinChip
            key={sk.name}
            skin={sk}
            active={skin === sk.name}
            // Localized label first; falls back to the catalogue label
            // so adding a skin name without a translation still renders.
            label={(t.skin as unknown as Record<string, string>)?.[sk.name] ?? sk.label}
            onSelect={() => setSkin(sk.name)}
          />
        ))}
      </div>
    </div>
  );
}

/** Chip layout, top → bottom:
 *   - row of three coloured dots (preview)
 *   - skin name (label)
 *
 *  The active chip uses a thicker, accent-coloured border ring so the
 *  selection is visible regardless of which skin is selected (a plain
 *  text colour change wouldn't be visible against `--hms-text`).
 */
function SkinChip({
  skin,
  label,
  active,
  onSelect,
}: {
  skin: Skin;
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-skin-name={skin.name}
      aria-pressed={active}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 'var(--hms-space-2)',
        padding: "10px 8px",
        borderRadius: 8,
        border: `1px solid ${active ? "var(--hms-accent)" : "var(--hms-border)"}`,
        boxShadow: active ? "0 0 0 1px var(--hms-accent)" : "none",
        background: "var(--hms-surface)",
        color: "var(--hms-text)",
        cursor: "pointer",
        fontSize: 'var(--hms-text-caption)',
        transition: "border-color 150ms, box-shadow 150ms",
      }}
    >
      <div style={{ display: "flex", gap: 'var(--hms-space-1)' }}>
        {skin.dots.map((c, i) => (
          <span
            key={i}
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: c,
              boxShadow: "0 0 0 0.5px rgba(0,0,0,0.08)",
            }}
          />
        ))}
      </div>
      <span>{label}</span>
    </button>
  );
}
