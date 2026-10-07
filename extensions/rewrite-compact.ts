/**
 * Rewrite-to-budget compaction extension.
 *
 * Replaces Pi's cumulative summarization (preserve old summary + append delta,
 * which ratchets upward on every cycle) with a bounded working-state rewrite:
 * one nested LLM call that must fit the checkpoint into SUMMARY_TOKEN_BUDGET,
 * dropping completed/stale detail instead of preserving it.
 *
 * Everything else — Pi's cut-point calculation, recent-tail retention
 * (firstKeptEntryId), session persistence, `/compact`, and the automatic
 * threshold machinery — is left untouched.
 *
 * Model selection: PI_COMPACT_MODEL="provider/model-id" wins when set and
 * resolvable; otherwise the session's own model is reused (fresh context, so
 * the current window pressure does not apply). Any failure (no model, empty
 * output, aborted or errored call) returns undefined so Pi falls back to its
 * default compaction.
 *
 * Usage:
 *   pi --extension ./extensions/rewrite-compact.ts
 * or install as a package:
 *   pi install git:github.com/exclamaforte/pi-rewrite-compact
 */

import { resolveSummaryBudget } from "../src/config.js";
import { uuidv7 } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";
import {
  COMPLETE_MAX_TOKENS,
  buildCheckpointMessages,
  extractSummaryText,
  parseModelRef,
} from "../src/checkpoint.js";

export default function (pi: ExtensionAPI) {
  pi.on("session_before_compact", async (event, ctx) => {
    const { preparation, customInstructions, signal } = event;
    const {
      messagesToSummarize,
      turnPrefixMessages,
      tokensBefore,
      firstKeptEntryId,
      previousSummary,
    } = preparation;

    const model = resolveModel(ctx);
    if (!model) {
      ctx.ui.notify("rewrite-compact: no model available, using default compaction", "warning");
      return;
    }

    const conversationText = serializeConversation(
      convertToLlm([...messagesToSummarize, ...turnPrefixMessages]),
    );
    const budget = resolveSummaryBudget({ cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted() });
    const messages = buildCheckpointMessages(
      {
        previousSummary,
        conversationText,
        customInstructions,
      },
      budget,
    );

    ctx.ui.notify(
      `rewrite-compact: rewriting checkpoint (${tokensBefore.toLocaleString()} tokens -> <=${budget.toLocaleString()}) with ${model.id}...`,
      "info",
    );

    try {
      // Fresh session id: this call gets its own context, unaffected by the
      // window pressure that triggered the compaction. No cache writes: this
      // one-off prompt is unlikely to be reused.
      const response = await ctx.modelRegistry.complete(
        model,
        { messages },
        {
          maxTokens: COMPLETE_MAX_TOKENS,
          signal,
          cacheRetention: "none",
          sessionId: uuidv7(),
        },
      );

      const summary = extractSummaryText(response);
      if (!summary.trim()) {
        if (!signal.aborted)
          ctx.ui.notify("rewrite-compact: empty checkpoint, using default compaction", "warning");
        return;
      }

      // SessionManager adds id/parentId. firstKeptEntryId keeps Pi's own
      // recent-tail retention behavior.
      return {
        compaction: {
          summary,
          firstKeptEntryId,
          tokensBefore,
          usage: response.usage,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`rewrite-compact failed: ${message}`, "error");
      // Fall back to default compaction on error.
      return;
    }
  });
}

export function resolveModel(
  ctx: Pick<ExtensionContext, "model" | "modelRegistry">,
): Model<any> | undefined {
  const ref = parseModelRef(process.env["PI_COMPACT_MODEL"]);
  if (ref) {
    const candidate = ctx.modelRegistry.find(ref.provider, ref.modelId);
    if (candidate && ctx.modelRegistry.hasConfiguredAuth(candidate)) return candidate;
  }
  return ctx.model ?? undefined;
}
