/**
 * Derives the list of file-writing tool calls from the current session's
 * messages so the WorkspaceContextPanel can show an "Artifacts" tab.
 *
 * Pure memo — no network calls, no side effects.
 */

import { useMemo } from "react";
import { useChatStore } from "@/store/chat";
import type { ToolCall } from "@/lib/hermes-types";

export interface Artifact {
  id: string;
  toolName: string;
  preview?: string;
  status: ToolCall["status"];
}

// Tool names that imply file mutations. Case-insensitive partial match.
const FILE_OP_RE = /write_file|edit_file|create_file|patch|str_replace|delete_file|move_file/i;

export function useSessionArtifacts(): Artifact[] {
  const messages = useChatStore((s) => s.messages);

  return useMemo(() => {
    const seen = new Set<string>();
    const artifacts: Artifact[] = [];

    for (const msg of messages) {
      const segs = msg.segments ?? msg.toolCalls?.map((tc) => ({ type: "tool" as const, tc })) ?? [];
      for (const seg of segs) {
        if (seg.type !== "tool") continue;
        const { tc } = seg;
        if (!FILE_OP_RE.test(tc.toolName)) continue;
        if (seen.has(tc.id)) continue;
        seen.add(tc.id);
        artifacts.push({
          id: tc.id,
          toolName: tc.toolName,
          preview: tc.preview,
          status: tc.status,
        });
      }
    }

    return artifacts;
  }, [messages]);
}
