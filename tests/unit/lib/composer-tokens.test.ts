import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { highlightComposerTokens, composerCurrentToken } from "@/lib/composer-tokens";

/** Pull the highlighted token strings out of the mixed string/element output. */
function tokens(nodes: ReturnType<typeof highlightComposerTokens>): unknown[] {
  return nodes
    .filter((n): n is ReactElement => typeof n === "object" && n !== null)
    .map((n) => (n.props as { children?: unknown }).children);
}

describe("highlightComposerTokens", () => {
  it("highlights a leading /command", () => {
    expect(tokens(highlightComposerTokens("/topic hello"))).toEqual(["/topic"]);
  });

  it("highlights @mentions anywhere in the line", () => {
    expect(tokens(highlightComposerTokens("hi @code and @writer"))).toEqual(["@code", "@writer"]);
  });

  it("highlights a leading command on each line", () => {
    expect(tokens(highlightComposerTokens("plain\n/handoff x"))).toEqual(["/handoff"]);
  });

  it("leaves plain text untokenised", () => {
    expect(tokens(highlightComposerTokens("just some words"))).toEqual([]);
  });

  it("does not treat a mid-word slash as a command", () => {
    expect(tokens(highlightComposerTokens("a/b path"))).toEqual([]);
  });

  it("does not highlight an @ embedded in a word (email)", () => {
    expect(tokens(highlightComposerTokens("mail me at a@b.com"))).toEqual([]);
  });
});

describe("composerCurrentToken (cursor-aware autocomplete)", () => {
  it("detects a slash token at the cursor", () => {
    expect(composerCurrentToken("/top", 4)).toEqual({ kind: "slash", query: "top", start: 0 });
  });

  it("detects a mid-text @mention at the cursor (multiple mentions)", () => {
    expect(composerCurrentToken("hi @co", 6)).toEqual({ kind: "mention", query: "co", start: 3 });
  });

  it("returns null when the cursor isn't in a token", () => {
    expect(composerCurrentToken("hello world", 11)).toBeNull();
  });

  it("ignores an @ embedded in a word", () => {
    expect(composerCurrentToken("a@b", 3)).toBeNull();
  });
});
