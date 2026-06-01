import { useFontSizeStore, FONT_SIZES, type FontSize } from "@/store/app";
import { useI18n } from "@/i18n";

/**
 * Font size picker.
 *
 * Sets `<html data-font-size="<value>">`; the cascade in
 * `skin-bridge.css` adjusts the root `font-size` and a
 * `--hms-font-scale` token. Live: takes effect immediately, no reload.
 *
 * Visual: each chip renders the same "Aa" preview in a different size
 * so the user can eyeball the result before committing — matching the
 * mockup in the issue feedback.
 */
export default function FontSizeSelector() {
  const { t } = useI18n();
  const { fontSize, setFontSize } = useFontSizeStore();

  return (
    <div>
      <div style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)", marginBottom: 8 }}>
        {t.fontSize.sectionLabel}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 'var(--hms-space-2)',
        }}
      >
        {FONT_SIZES.map((sz) => (
          <FontSizeChip
            key={sz}
            size={sz}
            active={fontSize === sz}
            label={(t.fontSize as unknown as Record<string, string>)?.[sz] ?? FALLBACK_LABEL[sz]}
            onSelect={() => setFontSize(sz)}
          />
        ))}
      </div>
    </div>
  );
}

/** English fallbacks for the chip labels — used when the locale lacks
 *  a translation. Capitalised because the i18n entries are too. */
const FALLBACK_LABEL: Record<FontSize, string> = {
  "small": "Small",
  "default": "Default",
  "large": "Large",
  "extra-large": "Extra Large",
};

/** Preview "Aa" font-size by chip — pure visual hint, not tied to the
 *  actual chosen size (we want the previews to stay visible regardless
 *  of which row is active). */
const PREVIEW_PX: Record<FontSize, number> = {
  "small": 12,
  "default": 16,
  "large": 20,
  "extra-large": 26,
};

function FontSizeChip({
  size,
  label,
  active,
  onSelect,
}: {
  size: FontSize;
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-font-size={size}
      aria-pressed={active}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 'var(--hms-space-2)',
        padding: "12px 8px",
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
      <span style={{ fontSize: PREVIEW_PX[size], fontWeight: 500, lineHeight: 1 }}>Aa</span>
      <span>{label}</span>
    </button>
  );
}
