import { create } from "zustand";
import type { FileRoot } from "@/hooks/useFiles";

/**
 * zustand selection stores for the three SidePanel-style
 * routes (``/profile`` · ``/cron`` · ``/files``).
 *
 * Mirrors the ``useChatStore`` pattern used by ``/chat`` so the
 * sidebar list and the main pane stay in sync without resorting to
 * URL-hash plumbing, which polluted the browser history every click
 * and clashed with the existing hash-routed tab state inside
 * ``/settings`` / ``/models``.
 *
 * Each store keeps a single id + a setter. No persistence — selection
 * is per-session ephemeral state (matches ChatStore: ``activeSessionId``
 * is also non-persisted across reloads).
 */

// ── /profile ─────────────────────────────────────────────────────────

interface ProfileSelectionState {
  selectedName: string | null;
  setSelected: (name: string | null) => void;
}

export const useProfileSelection = create<ProfileSelectionState>((set) => ({
  selectedName: null,
  setSelected: (name) => set({ selectedName: name }),
}));

// ── /cron ────────────────────────────────────────────────────────────

interface CronSelectionState {
  selectedJobId: string | null;
  setSelected: (id: string | null) => void;
}

export const useCronSelection = create<CronSelectionState>((set) => ({
  selectedJobId: null,
  setSelected: (id) => set({ selectedJobId: id }),
}));

// ── /skills ──────────────────────────────────────────────────────────

// Two-level selection: the left list picks a category or the Toolsets view;
// within a category, an optional skill is expanded for its SKILL.md.
export type SkillsView =
  | { kind: "all" }
  | { kind: "category"; key: string }
  | { kind: "toolsets" }
  | { kind: "mcp" };

interface SkillsSelectionState {
  view: SkillsView | null;
  selectedSkill: string | null;
  setView: (view: SkillsView | null) => void;
  setSelectedSkill: (name: string | null) => void;
}

export const useSkillsSelection = create<SkillsSelectionState>((set) => ({
  view: null,
  selectedSkill: null,
  setView: (view) => set({ view, selectedSkill: null }),
  setSelectedSkill: (selectedSkill) => set({ selectedSkill }),
}));

// ── /files ───────────────────────────────────────────────────────────

export interface FileSelection {
  root: FileRoot;
  path: string;
}

interface FilesSelectionState {
  /** Currently-active root for the side tree (``hermes`` | ``workspace``). */
  root: FileRoot;
  setRoot: (root: FileRoot) => void;
  /** Currently-open file in the main pane (null = pick-a-file empty state). */
  selected: FileSelection | null;
  setSelected: (sel: FileSelection | null) => void;
  /** Expanded tree folders — shared so the /chat workspace tree and the /files
   *  page tree (same component, two mounts) stay identical. */
  expanded: Set<string>;
  setExpanded: (next: Set<string>) => void;
}

export const useFilesSelection = create<FilesSelectionState>((set) => ({
  // Default to the `workspace` root — it now opens at the user's home (~/).
  root: "workspace",
  selected: null,
  expanded: new Set<string>(),
  setRoot: (root) =>
    set((state) => ({
      root,
      // Switching roots clears the selection — the path doesn't translate
      // across roots and we don't want to surface a stale ``hermes:foo``
      // selection after the user clicked on the ``workspace`` tab.
      selected: state.selected && state.selected.root === root ? state.selected : null,
      // Old expansion paths don't apply to the new root.
      expanded: new Set<string>(),
    })),
  setSelected: (sel) => set({ selected: sel }),
  setExpanded: (expanded) => set({ expanded }),
}));
