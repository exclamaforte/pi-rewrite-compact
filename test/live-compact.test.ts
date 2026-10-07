/**
 * Live integration test: runs a real `pi` process on a dummy session with the
 * extension loaded and a forced compaction threshold, then inspects the
 * persisted session file.
 *
 * Opt-in only: it spends real model calls. Run with:
 *
 *   PI_LIVE_COMPACT=1 npm run test:live
 *
 * Everything is isolated: a temp session dir (--session-dir) and a temp cwd
 * for project settings. Auth and model config come from
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Vitest runs from the repo root, so resolve the extension from the cwd.
const repoRoot = process.cwd();
const extensionPath = join(repoRoot, "extensions", "rewrite-compact.ts");

const SECTIONS = [
  "Current objective",
  "Current state",
  "Important findings/decisions",
  "Unresolved issues",
  "Relevant artifacts/files/beads",
  "Next actions",
];

function findSessionFile(sessionDir: string, sessionId: string): string | undefined {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.includes(sessionId) && entry.name.endsWith(".jsonl")) hits.push(full);
    }
  };
  walk(sessionDir);
  return hits[0];
}

describe.skipIf(!process.env["PI_LIVE_COMPACT"])("live compaction", () => {
  it(
    "produces a bounded rewrite checkpoint on a dummy session",
    () => {
      const root = mkdtempSync(join(tmpdir(), "pi-rewrite-compact-live-"));
      const sessionDir = join(root, "sessions");
      const workdir = join(root, "work");
      mkdirSync(join(workdir, ".pi"), { recursive: true });
      mkdirSync(sessionDir, { recursive: true });

      // Force the compaction threshold: trigger fires when
      // contextTokens > contextWindow - reserveTokens, so a reserve larger
      // than the model's window guarantees compaction. NOTE: a per-model
      // `modelOverrides` entry (e.g. in ~/.pi/agent/settings.json) takes
      // precedence over top-level keys, so the override must be set for the
      // ambient default model too (currently opencode-go/muse-spark-1.3 with
      // a 1M-token window; the top-level keys cover any other model).
      // --approve is required so the temp project's settings are trusted.
      writeFileSync(
        join(workdir, ".pi", "settings.json"),
        JSON.stringify({
          compaction: {
            reserveTokens: 2000000,
            keepRecentTokens: 2000,
            modelOverrides: {
              "opencode-go/muse-spark-1.3-contributor": {
                reserveTokens: 2000000,
                keepRecentTokens: 2000,
              },
            },
          },
        }),
      );
      // A chain of bulk files forces several dependent read batches, so the
      // between-turn threshold check runs with a summarizable span (the
      // small keepRecentTokens above keeps the required bulk modest).
      for (let i = 0; i < 3; i++) {
        const next = i < 2 ? `file${i + 1}.txt` : "END";
        const bulk = Array.from(
          { length: 120 },
          (_, j) => `payload line ${j} for file ${i} with filler text xyzzy\n`,
        ).join("");
        writeFileSync(join(workdir, `file${i}.txt`), bulk + `NEXT:${next}\n`);
      }

      const sessionId = "livecompact1";
      const proc = spawnSync(
        "pi",
        [
          "--session-id",
          sessionId,
          "--session-dir",
          sessionDir,
          "--extension",
          extensionPath,
          "--approve",
          "--tools",
          "read",
          "--print",
          "Read file0.txt with the read tool, follow each NEXT filename in turn until END, then reply with the chain you followed.",
        ],
        {
          cwd: workdir,
          encoding: "utf-8",
          timeout: 240000,
        },
      );
      if (proc.status !== 0 || proc.error) {
        console.log(`STDOUT:::${proc.stdout}:::STDERR:::${proc.stderr}:::ERR:::${proc.error}:::HOME:::${process.env["HOME"]}`);
      }
      expect(proc.status).toBe(0);

      expect(existsSync(sessionDir)).toBe(true);
      const sessionFile = findSessionFile(sessionDir, sessionId);
      expect(sessionFile, `session file for ${sessionId}`).toBeDefined();

      const entries = readFileSync(sessionFile!, "utf-8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const compactions = entries.filter((entry) => entry.type === "compaction");
      expect(compactions.length).toBeGreaterThan(0);

      // Every checkpoint must follow the rewrite contract: six sections and a
      // hard size bound (5000 tokens ~= 20k chars; 30k chars allows slack).
      for (const entry of compactions) {
        const summary: string = entry.summary ?? "";
        for (const section of SECTIONS) expect(summary).toContain(section);
        expect(summary.length).toBeLessThan(30000);
      }
    },
    300000,
  );
});
