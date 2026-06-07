import { useEffect, useMemo, useRef } from "react";
import type { SlashCommand } from "@/lib/slash-commands";
import { useDiscoverSlashCommands } from "@/store/discovery";
import { useI18n } from "@/i18n";

interface SlashMenuProps {
  query: string;
  selectedIndex: number;
  onSelect: (cmd: SlashCommand) => void;
  onClose: () => void;
  /** Optional override — Composer maintains the filtered list itself for
   *  keyboard navigation, so it passes the same filter result back here to
   *  avoid recomputing. When omitted, this component fetches & filters on
   *  its own (used by tests / Storybook). */
  commands?: SlashCommand[];
  /** Token prefix shown before each name ("/" for commands, "@" for the
   *  /agents room's member mentions). */
  prefix?: string;
}

/**slash command menu sourced from /api/discover/slash-commands.
 *
 *  The menu used to render a hardcoded ``SLASH_COMMANDS`` array; now it
 *  consumes the dynamic registry so new built-in / plugin commands
 *  appear without any front-end change. Description text first checks
 *  the ``slash.<name>`` i18n key, then falls back to whatever the
 *  backend provided.
 */
export default function SlashMenu({ query, selectedIndex, onSelect, onClose, commands, prefix = "/" }: SlashMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const { data } = useDiscoverSlashCommands();

  // Use caller-provided list when available; otherwise re-derive from
  // the discovery payload + current query. Keeps the menu honest when
  // mounted standalone (tests) and avoids double-filtering at runtime.
  const filtered: SlashCommand[] = useMemo(() => {
    if (commands) return commands;
    const all: SlashCommand[] = (data?.commands ?? []).map((c) => ({
      name: c.name,
      description: c.description,
    }));
    const prefix = query.replace(/^\//, "");
    return all.filter((c) => c.name.startsWith(prefix));
  }, [commands, data, query]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIndex}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Close when clicking outside the menu
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  if (filtered.length === 0) return null;

  // Helper — resolve a command's display description. i18n key wins; the
  // backend's ``description`` is the fallback; if both are blank, the
  // right column collapses to whitespace (no crash, no "undefined").
  const describe = (cmd: SlashCommand): string => {
    const key = `slash.${cmd.name}` as const;
    // ``t`` is typed against a fixed interface; we know the slash
    // namespace allows arbitrary keys (see types.ts), so a cast is
    // honest here.
    const localized = (t.slash as unknown as Record<string, string>)[cmd.name];
    return localized && localized !== key ? localized : cmd.description;
  };

  return (
    <div
      ref={listRef}
      style={{
        position: "absolute",
        bottom: "calc(100% + 6px)",
        left: 0,
        right: 0,
        background: "var(--hms-surface)",
        border: "1px solid var(--hms-border)",
        borderRadius: 10,
        overflow: "hidden",
        overflowY: "auto",
        maxHeight: 260,
        zIndex: 50,
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
      }}
    >
      {filtered.map((cmd, idx) => (
        <div
          key={cmd.name}
          data-idx={idx}
          data-active={idx === selectedIndex}
          onMouseDown={(e) => {
            e.preventDefault(); // prevent textarea blur
            onSelect(cmd);
          }}
          className="hms-sidebar-row"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 'var(--hms-space-3)',
            padding: "8px 14px",
            cursor: "pointer",
            borderBottom: "1px solid var(--hms-border)",
          }}
        >
          <span style={{ fontFamily: "monospace", fontSize: 'var(--hms-text-sm)', color: "var(--hms-text)", flexShrink: 0 }}>{prefix}{cmd.name}</span>
          {cmd.args && (
            <span style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)", flexShrink: 0 }}>{cmd.args}</span>
          )}
          <span style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)", marginLeft: "auto", textAlign: "right" }}>
            {describe(cmd)}
          </span>
        </div>
      ))}
    </div>
  );
}
