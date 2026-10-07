/**
 * Rewrite-to-budget checkpoint logic.
 *
 * Pure functions only (no pi imports) so they are unit-testable without a
 * running Pi process.
 *
 * Semantic contract (vs Pi's default UPDATE-style summarization):
 *   Pi:      preserve(previousSummary) + delta  -> next summary (grows)
 *   rewrite: rewrite_to_budget(previousSummary ∪ delta) -> next summary (bounded)
 */

export const SUMMARY_TOKEN_BUDGET = 5000;

/** Provider-side output cap: a backstop above the prompt budget. */
export const COMPLETE_MAX_TOKENS = 8192;

export interface CheckpointInput {
  /** Summary produced by the previous compaction, if any. */
  previousSummary?: string;
  /** Serialized conversation span being compacted away. */
  conversationText: string;
  /** Operator instructions from `/compact [...]`, if any. */
  customInstructions?: string;
}

const REQUIREMENTS = `Create a replacement working-state checkpoint for an autonomous coding/research agent.

This output REPLACES the previous checkpoint. It is not an append-only history.

Hard requirements:
- Maximum ${SUMMARY_TOKEN_BUDGET.toLocaleString()} tokens.
- Deduplicate aggressively.
- Remove completed work unless its result constrains future work.
- Remove stale hypotheses and superseded decisions.
- Do not preserve information merely because it appeared in the previous summary.
- Beads is the authoritative task/decision tracker.
- Files in the repository are the authoritative source for experiment results.
- Do not copy experiment output into this checkpoint when a path/result artifact can identify it instead.
- Preserve exact paths, identifiers, commands, errors, constraints, and numerical results only when they matter to continuing the current task.
- Preserve unresolved hypotheses, current blockers, and immediate next actions.

Organize as:
Current objective
Current state
Important findings/decisions
Unresolved issues
Relevant artifacts/files/beads
Next actions`;

export function buildCheckpointText(input: CheckpointInput): string {
  const previous =
    input.previousSummary && input.previousSummary.trim()
      ? `<previous-checkpoint>\n${input.previousSummary}\n</previous-checkpoint>\n\n`
      : "";
  const extra =
    input.customInstructions && input.customInstructions.trim()
      ? `\n\nAdditional operator instructions for this checkpoint (take precedence on conflict):\n${input.customInstructions}\n`
      : "";
  return `${REQUIREMENTS}${extra}\n\n${previous}<new-history>\n${input.conversationText}\n</new-history>`;
}

export interface CheckpointMessage {
  role: "user";
  content: [{ type: "text"; text: string }];
  timestamp: number;
}

export function buildCheckpointMessages(input: CheckpointInput): CheckpointMessage[] {
  return [
    {
      role: "user",
      content: [{ type: "text", text: buildCheckpointText(input) }],
      timestamp: Date.now(),
    },
  ];
}

interface TextPart {
  type: string;
  text?: string;
}

/** Join text parts of a nested-call response; non-text parts are ignored. */
export function extractSummaryText(response: { content: TextPart[] }): string {
  return response.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
}

/**
 * Parse "provider/model-id" references (e.g. "google/gemini-2.5-flash").
 * Returns undefined for anything that is not exactly provider/model.
 */
export function parseModelRef(
  ref: string | undefined,
): { provider: string; modelId: string } | undefined {
  if (!ref) return undefined;
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) return undefined;
  const provider = ref.slice(0, slash).trim();
  const modelId = ref.slice(slash + 1).trim();
  if (!provider || !modelId || modelId.includes("/")) return undefined;
  return { provider, modelId };
}
