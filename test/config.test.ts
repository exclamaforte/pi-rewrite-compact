import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SUMMARY_TOKEN_BUDGET, buildCheckpointText } from "../src/checkpoint.js";
import {
  MAX_SUMMARY_TOKEN_BUDGET,
  MIN_SUMMARY_TOKEN_BUDGET,
  resolveSummaryBudget,
} from "../src/config.js";

describe("buildCheckpointText with explicit budget", () => {
  it("uses the default budget when omitted", () => {
    expect(buildCheckpointText({ conversationText: "x" })).toContain(
      `Maximum ${SUMMARY_TOKEN_BUDGET.toLocaleString()} tokens.`,
    );
  });

  it("renders a custom budget", () => {
    const text = buildCheckpointText({ conversationText: "x" }, 3000);
    expect(text).toContain("Maximum 3,000 tokens.");
    expect(text).not.toContain("Maximum 5,000 tokens.");
  });
});

describe("resolveSummaryBudget", () => {
  let root: string;
  let agentDir: string;
  let workdir: string;

  const globalSettings = (value: unknown) =>
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ rewriteCompact: { summaryTokenBudget: value } }));
  const projectSettings = (value: unknown) => {
    mkdirSync(join(workdir, ".pi"), { recursive: true });
    writeFileSync(
      join(workdir, ".pi", "settings.json"),
      JSON.stringify({ rewriteCompact: { summaryTokenBudget: value } }),
    );
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rewrite-compact-config-"));
    agentDir = join(root, "agent");
    workdir = join(root, "work");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(workdir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const resolve = (projectTrusted = true) =>
    resolveSummaryBudget({ cwd: workdir, projectTrusted, agentDir });

  it("falls back to the default when no settings exist", () => {
    expect(resolve()).toBe(SUMMARY_TOKEN_BUDGET);
  });

  it("reads the global budget", () => {
    globalSettings(3000);
    expect(resolve()).toBe(3000);
  });

  it("prefers the trusted project budget over global", () => {
    globalSettings(3000);
    projectSettings(1500);
    expect(resolve()).toBe(1500);
  });

  it("ignores the project budget when untrusted", () => {
    globalSettings(3000);
    projectSettings(1500);
    expect(resolve(false)).toBe(3000);
  });

  it("falls back on invalid values", () => {
    for (const bad of [-1, 0, 42, 1.5, "3000", null, MIN_SUMMARY_TOKEN_BUDGET - 1, MAX_SUMMARY_TOKEN_BUDGET + 1]) {
      globalSettings(bad);
      expect(resolve()).toBe(SUMMARY_TOKEN_BUDGET);
    }
  });

  it("falls back on malformed settings files", () => {
    writeFileSync(join(agentDir, "settings.json"), "{ not json");
    expect(resolve()).toBe(SUMMARY_TOKEN_BUDGET);
  });

  it("never throws when directories are missing", () => {
    expect(
      resolveSummaryBudget({ cwd: join(root, "nope"), projectTrusted: true, agentDir: join(root, "noagent") }),
    ).toBe(SUMMARY_TOKEN_BUDGET);
  });
});
