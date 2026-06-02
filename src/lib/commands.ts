// Pure command registry for the ⌘K palette. Navigation commands are derived
// from the single ROUTES table so the palette can never drift from the real
// route list (the old GlobalSearch hard-coded a parallel NAV_ENTRIES array that
// did drift). Kept framework-light + side-effect-free so the registry assembly
// and the fuzzy filter are unit-testable without rendering the overlay.

import { ROUTES } from "@/routes/registry";
import type { Translations } from "@/i18n/types";

export interface Command {
  id: string;
  label: string;
  group: "action" | "page";
  /** Extra search terms beyond the label (e.g. the route path). */
  keywords?: string;
  run: () => void;
}

/** Navigation commands, one per route, labelled via i18n `nav.*`. Hidden routes
 *  (/chat, /files, /settings, /profile) are intentionally included — the palette
 *  is exactly the "other affordance" that reaches them. */
export function navCommands(t: Translations, navigate: (to: string) => void): Command[] {
  return ROUTES.map((r) => ({
    id: `nav:${r.path}`,
    label: t.nav[r.labelKey],
    group: "page" as const,
    keywords: r.path,
    run: () => navigate(r.path),
  }));
}

/** Case-insensitive substring match over label + keywords; empty query = all. */
export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter(
    (c) => c.label.toLowerCase().includes(q) || (c.keywords ?? "").toLowerCase().includes(q),
  );
}
