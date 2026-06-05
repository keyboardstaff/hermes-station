import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { highlightComposerTokens } from "@/lib/composer-tokens";

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
});
