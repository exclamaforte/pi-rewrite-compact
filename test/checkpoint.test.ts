import { describe, expect, it } from "vitest";
import {
  COMPLETE_MAX_TOKENS,
  SUMMARY_TOKEN_BUDGET,
  buildCheckpointMessages,
  buildCheckpointText,
  extractSummaryText,
  parseModelRef,
} from "../src/checkpoint.js";

describe("buildCheckpointText", () => {
  it("states the token budget and the six required sections", () => {
    const text = buildCheckpointText({ conversationText: "did some work" });
    expect(text).toContain("5,000");
    for (const section of [
      "Current objective",
      "Current state",
      "Important findings/decisions",
      "Unresolved issues",
      "Relevant artifacts/files/beads",
      "Next actions",
    ]) {
      expect(text).toContain(section);
    }
  });

  it("declares replacement semantics, not append semantics", () => {
    const text = buildCheckpointText({ conversationText: "x" });
    expect(text).toContain("REPLACES the previous checkpoint");
    expect(text).toContain("Do not preserve information merely because it appeared");
    expect(text).toContain("Deduplicate aggressively");
  });

  it("points at Beads and files as authoritative instead of copying output", () => {
    const text = buildCheckpointText({ conversationText: "x" });
    expect(text).toContain("Beads is the authoritative task/decision tracker");
    expect(text).toContain("Files in the repository are the authoritative source");
    expect(text).toContain("Do not copy experiment output");
  });

  it("wraps the previous checkpoint and the new history in labeled blocks", () => {
    const text = buildCheckpointText({
      previousSummary: "old state",
      conversationText: "new events",
    });
    expect(text).toContain("<previous-checkpoint>\nold state\n</previous-checkpoint>");
    expect(text).toContain("<new-history>\nnew events\n</new-history>");
  });

  it("omits the previous-checkpoint block when there is no previous summary", () => {
    expect(buildCheckpointText({ conversationText: "x" })).not.toContain("<previous-checkpoint>");
    expect(
      buildCheckpointText({ previousSummary: "   ", conversationText: "x" }),
    ).not.toContain("<previous-checkpoint>");
  });

  it("appends operator instructions only when provided", () => {
    const without = buildCheckpointText({ conversationText: "x" });
    expect(without).not.toContain("operator instructions");
    const withExtra = buildCheckpointText({
      conversationText: "x",
      customInstructions: "focus on the decoder",
    });
    expect(withExtra).toContain("focus on the decoder");
    expect(withExtra).toContain("take precedence on conflict");
  });
});

describe("buildCheckpointMessages", () => {
  it("returns a single user message carrying the checkpoint text", () => {
    const messages = buildCheckpointMessages({ conversationText: "work happened" });
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toHaveLength(1);
    expect(messages[0].content[0].type).toBe("text");
    expect(messages[0].content[0].text).toContain("work happened");
    expect(typeof messages[0].timestamp).toBe("number");
  });
});

describe("extractSummaryText", () => {
  it("joins text parts and ignores non-text parts", () => {
    expect(
      extractSummaryText({
        content: [
          { type: "text", text: "part one" },
          { type: "image" },
          { type: "text", text: "part two" },
          { type: "text" },
        ],
      }),
    ).toBe("part one\npart two");
  });

  it("returns empty string when there is no text", () => {
    expect(extractSummaryText({ content: [] })).toBe("");
    expect(extractSummaryText({ content: [{ type: "thinking" }] })).toBe("");
  });
});

describe("parseModelRef", () => {
  it("parses provider/model references", () => {
    expect(parseModelRef("google/gemini-2.5-flash")).toEqual({
      provider: "google",
      modelId: "gemini-2.5-flash",
    });
  });

  it("rejects malformed references", () => {
    expect(parseModelRef(undefined)).toBeUndefined();
    expect(parseModelRef("")).toBeUndefined();
    expect(parseModelRef("justamodel")).toBeUndefined();
    expect(parseModelRef("/model")).toBeUndefined();
    expect(parseModelRef("provider/")).toBeUndefined();
    expect(parseModelRef("a/b/c")).toBeUndefined();
  });
});

describe("budgets", () => {
  it("keeps the provider cap above the prompt budget", () => {
    expect(SUMMARY_TOKEN_BUDGET).toBe(5000);
    expect(COMPLETE_MAX_TOKENS).toBeGreaterThanOrEqual(SUMMARY_TOKEN_BUDGET);
  });
});
