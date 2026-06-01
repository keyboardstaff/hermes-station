# Hermes Station UI Conventions

> Status: living contract (owner review D20, 2026-05-31).
> Tokens: [`src/styles/tokens.css`](../src/styles/tokens.css) (structure) +
> [`src/styles/theme.css`](../src/styles/theme.css) (color + shared classes).
> Primitives: [`src/components/ui/`](../src/components/ui/).

This is the **single source of truth for UI detail** — button sizes, hover
behaviour, list rows, inputs, scrollbars. The building blocks already exist
(primitives + a full token catalog); what was missing was a written rule for
*when to reach for which*, so details drifted (hand-rolled `<button>`s, inline
`onMouseEnter` hovers, ad-hoc input styling). New code follows this; old code
migrates opportunistically (see **Migration** below).

The one rule under everything: **no raw numeric/color literals in TSX** — every
dimension, color, radius, and space is a `var(--hms-*)` token. `tokens.css` is
the only place numbers live (`scripts/lint_no_hardcoding.sh` guards the backend
equivalent; this is the frontend discipline).

---

## 1. Buttons

| Need | Use | Notes |
|---|---|---|
| Text / text+icon action | [`<Button>`](../src/components/ui/Button.tsx) | `size` = `sm \| md \| lg`, `variant` = `default \| primary \| danger`. Wraps the `.hms-btn-*` classes. |
| Square icon-only action (26/32px) | [`<IconButton>`](../src/components/ui/IconButton.tsx) | `size` = `sm \| md`, `active`, `danger`. Token-only; shares `.hms-sidebar-row` hover. |
| Two/three exclusive choices | [`<SegmentedControl>`](../src/components/ui/SegmentedControl.tsx) / [`<ButtonGroup>`](../src/components/ui/ButtonGroup.tsx) | — |

**Do not hand-roll `<button>` with inline padding/background** for these cases.
Sizes are fixed by the contract — never invent a fourth button height:

- `sm` → `3px 8px`, 12px text (badges, inline row actions)
- `md` → `6px 12px`, 13px text (toolbars, standard actions) — **default**
- `lg` → `8px 16px`, 14px text (primary CTA / form submit)

Variant intent: `default` = bordered/transparent; `primary` = filled
(`--hms-text` on `--hms-bg`); `danger` = destructive. Disabled is `opacity:
0.45` (handled by `.hms-btn:disabled` — don't re-implement).

A raw `<button>` is only acceptable for a genuinely bespoke composite (e.g. a
list row that *is* a button, a custom popover trigger). When you do, give it
`className="hms-sidebar-row"` (or another shared class) for hover rather than
inline handlers — see §2.

## 2. Hover & interactive states

**Hover backgrounds are CSS, not JavaScript.** Do not use
`onMouseEnter`/`onMouseLeave` to swap `style.background`. Apply a shared class
whose `:hover` is defined once in `theme.css`:

- `hms-sidebar-row` — the canonical hoverable row/button (`:hover` →
  `--hms-hover-bg`; `[data-active="true"]` → `--hms-selected-bg`). Used by
  list rows, icon buttons, nav items.
- `hms-btn` (+ variants) — buttons, via `<Button>`.

Tokens: `--hms-hover-bg`, `--hms-selected-bg` (both theme-aware, defined for
light + dark in `theme.css`). Reach for JS hover state **only** when the hover
must also change sibling state the CSS can't reach (rare).

What should be hoverable: anything clickable (buttons, rows, tabs, menu items).
What should not: static text, labels, disabled controls.

Touch: hover-only affordances must have a non-hover fallback — see the
`@media (hover: none)` block in `theme.css` (message actions are always shown
on touch). Don't ship a hover-gated control with no touch path.

## 3. Lists & two-column pages

- Capability/management pages use [`<PanelTwoColumn>`](../src/components/ui/PanelTwoColumn.tsx)
  (side list + content). Widths come from `--hms-panel-list-{w,min,max}`.
- List rows: one element with `className="hms-sidebar-row"`, `data-active` for
  selection, consistent `--hms-space-*` padding. The active row's hover is a
  no-op (already highlighted) — that's baked into the class, don't fight it.
- Row height/padding from spacing tokens; never hardcode pixels.

## 4. Inputs, selects, search

| Need | Use |
|---|---|
| Search field (leading magnifier) | [`<SearchInput>`](../src/components/ui/SearchInput.tsx) (`size` = `sm \| md`) |
| Labeled form field | [`<Field>`](../src/components/ui/Field.tsx) |
| Dropdown / popover select | [`<PopupSelect>`](../src/components/ui/PopupSelect.tsx) |

Raw `<input>`/`<select>` (e.g. inside the config FORM, inline rename) style
from tokens: `--hms-input-bg`, `--hms-input-border`, `--hms-input-radius`,
height `--hms-input-h-{sm,md,lg}`, padding `--hms-input-px`, `--hms-text-sm`.
Keep `box-sizing: border-box` and `outline: none` (focus ring via border
color). Don't invent new input heights — use the `--hms-input-h-*` scale.

## 5. Scrollbars

Styled once, globally, in `theme.css` (`::-webkit-scrollbar`, 4px thumb,
`--hms-radius-sm`). Scrollable regions just need `overflow: auto` — **do not**
restyle scrollbars per-component. Monaco's chrome is tuned to match (see
[`ConfigYamlEditor`](../src/components/settings/ConfigYamlEditor.tsx)).

## 6. Spacing, radius, type, color

- **Spacing:** `--hms-space-0…12` (4px scale). Gaps/padding/margins only from
  these.
- **Radius:** `--hms-radius-{sm,md,lg,xl,pill}`. `md` (6px) is the default for
  buttons/inputs; `lg`/`xl` for cards/popovers; `pill` for chips.
- **Type:** `--hms-text-{xs,sm,base,…}` + `--hms-text-{body,caption}`; weights
  `--hms-fw-*`; line-heights `--hms-lh-*`. No raw `font-size`/`fontWeight`.
- **Color:** semantic tokens from `theme.css` (`--hms-text`, `--hms-text-muted`,
  `--hms-border`, `--hms-surface`, `--hms-bg`, `--hms-accent`, `--hms-error*`,
  `--hms-success`, …). Never a raw hex except inside a `theme.css` token def.
- **Transitions:** `--hms-transition`; popover shadow `--hms-shadow-popover`.

## 7. Icons

[`lucide-react`](https://lucide.dev), sized to context: 11–12px inline / in
dense rows, 14–16px for toolbar/header actions. Give icon-only controls an
`aria-label`.

## 8. Page headers ([`PageTopBar`](../src/components/layout/PageTopBar.tsx))

Every routed panel's header is [`<PageTopBar>`](../src/components/layout/PageTopBar.tsx).
It has a **fixed-height title bar** (`--hms-header-h`, always bordered, so the
title line is at the same height on every page — owner review D22) and an
optional **`context` band** below it.

- **`title` / `subtitle`** — the page name; subtitle is a muted one-liner.
- **`actions`** (header right) — page-level *actions*, built from §1 primitives:
  - a primary action first (`<Button size="sm" variant="primary">`, e.g.
    "New board"),
  - batch actions next (export / delete, plain or `danger` `<Button>`),
  - a trailing `<IconButton>` refresh last.
  - Do **not** hand-roll `<button>` here, and do **not** put view controls here.
- **`context`** (second band) — *view controls*: search ([`<SearchInput>`](../src/components/ui/SearchInput.tsx)),
  filters, tabs, breadcrumbs, and **selectors** (board / time-range / tenant).
  A selector changes *what you're looking at*, so it belongs here, not in
  `actions`.

Rule of thumb: if it performs an action, it's `actions`; if it changes the
view, it's `context`.

---

## Migration (opportunistic, not a big-bang)

Primitives + tokens exist; adoption is uneven. The baseline at authoring time:
`<Button>` used in ~15 files, `<IconButton>` in 4, `<SearchInput>` in 4 — while
**8 panels hand-roll `<button>`** and **~15 files** hand-roll `onMouseEnter`
hover. Don't rewrite everything at once. The rule:

- **New code** follows this contract.
- **When you touch a file** for other reasons, migrate its hand-rolled buttons
  to `<Button>`/`<IconButton>` and its inline hover to a CSS class.
- Known hand-rolled-`<button>` panels to retire over time: `CronPanel` (3),
  `SessionsPanel`, `GroupPanel`, `ChannelsPanel` (2 each), `SettingsPanel`,
  `ProfilePanel`, `FilesPanel`, `AnalyticsPanel` (1 each).
- Known inline-hover offenders: `SessionRecents`, `PopupSelect` (2 each),
  `AnalyticsPanel`, `SessionsPanel`, `ModelPickerDialog`, `FileBreadcrumb`,
  `FileEditor`, `FileTreeNode`, `CronEmptyTemplates`, `ModelPicker`,
  `WorkspaceContextPanel`, `SlashMenu` (1 each). *(Some — `PopupSelect`,
  `Tooltip`, `PanelTwoColumn` — legitimately need JS hover for sibling/portal
  state; those are exempt.)*

This list is a snapshot, not a worklist to burn down in one PR — it exists so a
reviewer can see the surface and so "is this drift or intentional?" has an
answer.
