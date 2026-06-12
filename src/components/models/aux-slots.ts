/** The 9 upstream auxiliary task slots, in canonical order. */
export const AUX_SLOTS = [
  "vision",
  "web_extract",
  "compression",
  "session_search",
  "skills_hub",
  "approval",
  "mcp",
  "title_generation",
  "curator",
] as const;

export type AuxSlotKey = typeof AUX_SLOTS[number];

/** Readable fallback when no i18n label exists for a slot. */
export function prettySlot(slot: string): string {
  return slot
    .split("_")
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}
