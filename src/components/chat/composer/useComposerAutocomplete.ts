/** Token-level autocomplete for slash commands and @mentions in the Composer.
 *  Extracted from Composer.tsx so the state-heavy token/filter/keyboard logic
 *  is unit-testable without standing up the full composer. */
import { useState, useMemo } from "react";
import type { SlashCommand } from "@/lib/slash-commands";
import { useDiscoverSlashCommands } from "@/store/discovery";
import { composerCurrentToken, type ComposerToken } from "@/lib/composer-tokens";

interface UseComposerAutocompleteParams {
  setValue: React.Dispatch<React.SetStateAction<string>>;
  textRef: React.RefObject<HTMLTextAreaElement | null>;
  mentionNames?: string[];
}

export function useComposerAutocomplete({
  setValue,
  textRef,
  mentionNames,
}: UseComposerAutocompleteParams) {
  const [token, setToken] = useState<ComposerToken | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);

  const slashQuery = token?.kind === "slash" ? token.query : "";
  const mentionQuery = token?.kind === "mention" ? token.query.toLowerCase() : "";

  const { data: discoveredSlash } = useDiscoverSlashCommands();

  const filteredCmds = useMemo<SlashCommand[]>(() => {
    if (token?.kind !== "slash") return [];
    const all: SlashCommand[] = (discoveredSlash?.commands ?? []).map((c) => ({
      name: c.name,
      description: c.description,
    }));
    return all.filter((c) => c.name.startsWith(slashQuery));
  }, [discoveredSlash, slashQuery, token]);

  const filteredMentions = useMemo<SlashCommand[]>(() => {
    if (token?.kind !== "mention") return [];
    return (mentionNames ?? [])
      .filter((n) => n.toLowerCase().startsWith(mentionQuery))
      .map((n) => ({ name: n, description: "" }));
  }, [mentionNames, mentionQuery, token]);

  const showSlash = token?.kind === "slash" && filteredCmds.length > 0;
  const showMention = token?.kind === "mention" && filteredMentions.length > 0;

  const syncToken = (v: string, cursor: number | null) => {
    const next = composerCurrentToken(v, cursor ?? v.length);
    setToken(next);
    if (next) { setSlashIndex(0); setMentionIndex(0); }
  };

  const replaceToken = (char: "/" | "@", name: string) => {
    const insert = char + name + " ";
    setValue((prev) => {
      if (!token) return insert;
      const before = prev.slice(0, token.start);
      const after = prev.slice(token.start + 1 + token.query.length);
      const caret = before.length + insert.length;
      requestAnimationFrame(() => {
        const el = textRef.current;
        if (el) { el.focus(); el.setSelectionRange(caret, caret); }
      });
      return before + insert + after;
    });
    setToken(null);
  };

  const onSlashSelect = (cmd: SlashCommand) => replaceToken("/", cmd.name);
  const onMentionSelect = (cmd: SlashCommand) => replaceToken("@", cmd.name);

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setValue(v);
    syncToken(v, e.target.selectionStart);
  };

  /** Returns true if the key event was consumed (caller should return early). */
  const handleAutocompleteKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const native = e.nativeEvent as KeyboardEvent;
    const composing = native.isComposing || native.keyCode === 229;
    if (showSlash) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashIndex((i) => Math.min(i + 1, filteredCmds.length - 1)); return true; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlashIndex((i) => Math.max(i - 1, 0)); return true; }
      if (e.key === "Enter" && !composing && filteredCmds[slashIndex]) { e.preventDefault(); onSlashSelect(filteredCmds[slashIndex]); return true; }
      if (e.key === "Escape") { e.preventDefault(); setToken(null); return true; }
    }
    if (showMention && filteredMentions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => Math.min(i + 1, filteredMentions.length - 1)); return true; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => Math.max(i - 1, 0)); return true; }
      if (e.key === "Enter" && !composing && filteredMentions[mentionIndex]) { e.preventDefault(); onMentionSelect(filteredMentions[mentionIndex]); return true; }
      if (e.key === "Escape") { e.preventDefault(); setToken(null); return true; }
    }
    return false;
  };

  return {
    token,
    setToken,
    showSlash,
    showMention,
    filteredCmds,
    filteredMentions,
    slashIndex,
    mentionIndex,
    slashQuery,
    mentionQuery,
    onSlashSelect,
    onMentionSelect,
    syncToken,
    handleAutocompleteKey,
    onChange,
  };
}
