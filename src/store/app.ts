// App-level appearance stores — theme + skin + font-size collapsed into
// a single module. The three concerns are
// independent state machines so we expose them as three hooks; bundling
// the file just consolidates the three near-identical DOM-attribute /
// localStorage / mount-init recipes.

import { create } from "zustand";
import { DEFAULT_SKIN, SKIN_BY_NAME, type SkinName } from "@/styles/skins";

// ── Theme ─────────────────────────────────────────────────────────

export type ThemeMode = "light" | "dark" | "system";

interface ThemeStore {
  theme: ThemeMode;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: ThemeMode) => void;
}

const THEME_KEY = "hms_theme";

function readStoredTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch { /* ignore */ }
  return "system";
}

function systemPrefers(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? systemPrefers() : mode;
}

function applyThemeToDOM(resolved: "light" | "dark"): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolved;
}

export const useThemeStore = create<ThemeStore>((set, get) => {
  const initial = readStoredTheme();
  const resolved = resolveTheme(initial);
  applyThemeToDOM(resolved);

  if (typeof window !== "undefined" && window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (get().theme !== "system") return;
      const r = mq.matches ? "dark" : "light";
      applyThemeToDOM(r);
      set({ resolvedTheme: r });
    };
    mq.addEventListener("change", onChange);
  }

  return {
    theme: initial,
    resolvedTheme: resolved,
    setTheme: (theme) => {
      try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
      const r = resolveTheme(theme);
      applyThemeToDOM(r);
      set({ theme, resolvedTheme: r });
    },
  };
});

// ── Skin ──────────────────────────────────────────────────────────

interface SkinStore {
  skin: SkinName;
  setSkin: (s: SkinName) => void;
}

const SKIN_KEY = "hms_skin";

function readStoredSkin(): SkinName {
  try {
    const v = localStorage.getItem(SKIN_KEY);
    if (v && SKIN_BY_NAME[v]) return v as SkinName;
  } catch { /* localStorage disabled */ }
  return DEFAULT_SKIN;
}

function applySkinToDOM(skin: SkinName): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-skin", skin);
}

export const useSkinStore = create<SkinStore>((set) => {
  const initial = readStoredSkin();
  applySkinToDOM(initial);
  return {
    skin: initial,
    setSkin: (skin) => {
      try { localStorage.setItem(SKIN_KEY, skin); } catch { /* ignore */ }
      applySkinToDOM(skin);
      set({ skin });
    },
  };
});

// ── Tool-call display ─────────────────────────────────────────────
// Product = concise summary (raw payloads hidden); Technical = full
// input/output + reasoning. Mirrors upstream desktop's $toolViewMode.
// Defaults to Technical (owner pref): full detail out of the box.

export type ToolViewMode = "product" | "technical";

const TOOL_VIEW_KEY = "hms_tool_view";

function readStoredToolView(): ToolViewMode {
  try {
    const v = localStorage.getItem(TOOL_VIEW_KEY);
    if (v === "product" || v === "technical") return v;
  } catch { /* localStorage disabled */ }
  return "technical";
}

interface ToolViewStore {
  toolView: ToolViewMode;
  setToolView: (v: ToolViewMode) => void;
}

export const useToolViewStore = create<ToolViewStore>((set) => ({
  toolView: readStoredToolView(),
  setToolView: (toolView) => {
    try { localStorage.setItem(TOOL_VIEW_KEY, toolView); } catch { /* ignore */ }
    set({ toolView });
  },
}));

// ── Font size ─────────────────────────────────────────────────────

export type FontSize = "small" | "default" | "large" | "extra-large";

export const FONT_SIZES: readonly FontSize[] = ["small", "default", "large", "extra-large"] as const;
export const DEFAULT_FONT_SIZE: FontSize = "default";

const FONT_SIZE_KEY = "hms_font_size";

function readStoredFontSize(): FontSize {
  try {
    const v = localStorage.getItem(FONT_SIZE_KEY) as FontSize | null;
    if (v && FONT_SIZES.includes(v)) return v;
  } catch { /* localStorage disabled */ }
  return DEFAULT_FONT_SIZE;
}

function applyFontSizeToDOM(v: FontSize): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-font-size", v);
}

interface FontSizeStore {
  fontSize: FontSize;
  setFontSize: (v: FontSize) => void;
}

export const useFontSizeStore = create<FontSizeStore>((set) => {
  const initial = readStoredFontSize();
  applyFontSizeToDOM(initial);
  return {
    fontSize: initial,
    setFontSize: (fontSize) => {
      try { localStorage.setItem(FONT_SIZE_KEY, fontSize); } catch { /* ignore */ }
      applyFontSizeToDOM(fontSize);
      set({ fontSize });
    },
  };
});
