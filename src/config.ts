/**
 * Optional checkpoint-budget configuration via settings.json.
 *
 * Drop this in the global settings (~/.pi/agent/settings.json) or the
 * project settings (<project>/.pi/settings.json):
 *
 *   { "rewriteCompact": { "summaryTokenBudget": 3000 } }
 *
 * Project settings only apply when the project is trusted (same rule Pi
 * itself uses), and win over the global value. Anything missing or invalid
 * falls back to SUMMARY_TOKEN_BUDGET; resolution never throws.
 */
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SUMMARY_TOKEN_BUDGET } from "./checkpoint.js";

/** Hard floor/ceiling: below this a checkpoint is useless, above it the API output cap dominates anyway. */
export const MIN_SUMMARY_TOKEN_BUDGET = 500;
export const MAX_SUMMARY_TOKEN_BUDGET = 50000;

export interface BudgetSource {
  /** Session working directory; project settings resolve to <cwd>/.pi/settings.json. */
  cwd: string;
  /** From ctx.isProjectTrusted(): untrusted projects must not influence behavior. */
  projectTrusted: boolean;
  /** Override for tests; defaults to Pi's own agent-dir resolution. */
  agentDir?: string;
}

function readBudgetFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"))?.["rewriteCompact"]?.["summaryTokenBudget"];
  } catch {
    return undefined;
  }
}

function asValidBudget(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return undefined;
  if (value < MIN_SUMMARY_TOKEN_BUDGET || value > MAX_SUMMARY_TOKEN_BUDGET) return undefined;
  return value;
}

export function resolveSummaryBudget(source: BudgetSource): number {
  const agentDir = source.agentDir ?? getAgentDir();
  const global = asValidBudget(readBudgetFile(join(agentDir, "settings.json")));
  const project = source.projectTrusted
    ? asValidBudget(readBudgetFile(join(source.cwd, ".pi", "settings.json")))
    : undefined;
  return project ?? global ?? SUMMARY_TOKEN_BUDGET;
}
