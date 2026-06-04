import { describe, it, expect } from "vitest";
import { buildSessionActions } from "@/lib/session-actions";
import { en } from "@/i18n/en";

const ALL = {
  onRename: () => {},
  onTogglePin: () => {},
  onCopyId: () => {},
  onExportJson: () => {},
  onExportMarkdown: () => {},
  onExportPdf: () => {},
  onClearSession: () => {},
  onArchive: () => {},
  onDelete: () => {},
};

describe("buildSessionActions (single source for the ··· + right-click menus)", () => {
  it("emits the canonical ordered action set when every handler is present", () => {
    const keys = buildSessionActions(en, ALL).map((i) => i.key);
    expect(keys).toEqual([
      "pin",
      "rename",
      "copyId",
      "json",
      "md",
      "pdf",
      "clear",
      "archive",
      "delete",
    ]);
  });

  it("omits an action whose handler is absent (capability gating)", () => {
    const keys = buildSessionActions(en, {
      onRename: () => {},
      onCopyId: () => {},
    }).map((i) => i.key);
    expect(keys).toEqual(["rename", "copyId"]);
  });

  it("labels pin vs unpin from the pinned flag", () => {
    expect(buildSessionActions(en, { onTogglePin: () => {} })[0].label).toBe(en.nav.pin);
    expect(buildSessionActions(en, { pinned: true, onTogglePin: () => {} })[0].label).toBe(
      en.nav.unpin,
    );
  });

  it("marks delete destructive and copyId non-destructive", () => {
    const items = buildSessionActions(en, ALL);
    expect(items.find((i) => i.key === "delete")?.danger).toBe(true);
    expect(items.find((i) => i.key === "copyId")?.danger).toBeFalsy();
  });

  it("wires onSelect through to the supplied handler", () => {
    let hit = "";
    const items = buildSessionActions(en, { onCopyId: () => (hit = "copied") });
    items[0].onSelect();
    expect(hit).toBe("copied");
  });
});
