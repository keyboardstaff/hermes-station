// Skins mirror upstream's _BUILTIN_DASHBOARD_THEMES (6 entries — ``default-large``
// is dropped because the Appearance tab's Font size dial covers that axis).
//
// Each skin contributes a small delta on top of the Light/Dark Theme baseline:
//   --hms-accent, --hms-surface tint, dots[] — never touches --hms-bg / --hms-text
//   so the theme choice keeps full control of contrast.
//
// Dots are samples drawn from upstream's themes/presets.ts palette
// (background / warmGlow / midground or destructive).

export interface Skin {
  /** Stable id — DOM data-skin attribute + localStorage key. Must match upstream theme name. */
  name: string;
  /** Fallback when locale lacks the i18n entry. */
  label: string;
  /** Three swatch dots rendered inside the chip. */
  dots: [string, string, string];
}

// Order + default per owner review (2026-06-04). "slate" replaces the retired
// "rose" with upstream desktop's Slate palette; "default" is the Hermes Teal
// skin (kept its stable id for back-compat) and now trails the list.
export const SKINS: readonly Skin[] = [
  { name: "mono",      label: "Mono",      dots: ["#0e0e0e", "#8e8e8e", "#eaeaea"] },
  { name: "slate",     label: "Slate",     dots: ["#0d1117", "#58a6ff", "#a6c8ff"] },
  { name: "midnight",  label: "Midnight",  dots: ["#0a0a1f", "#a78bfa", "#d4c8ff"] },
  { name: "ember",     label: "Ember",     dots: ["#1a0a06", "#f97316", "#ffd8b0"] },
  { name: "cyberpunk", label: "Cyberpunk", dots: ["#040608", "#00ff88", "#9bffcf"] },
  { name: "default",   label: "Teal",      dots: ["#041c1c", "#ffbd38", "#ffe6cb"] },
] as const;

export type SkinName = (typeof SKINS)[number]["name"];

export const SKIN_BY_NAME: Record<string, Skin> = Object.fromEntries(
  SKINS.map((s) => [s.name, s]),
);

export const DEFAULT_SKIN: SkinName = "mono";
