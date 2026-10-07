# pi-rewrite-compact

A [Pi](https://github.com/earendil-works/pi) extension that replaces Pi's
cumulative compaction summarization with a bounded working-state rewrite.

## Why

Pi's default compaction feeds the previous summary back into the summarizer
with a preserve-style prompt. Each cycle's output becomes the next cycle's
must-keep input, so summaries ratchet upward (observed: 11KB → 18KB across 11
compactions) and compaction starts firing every turn — a compact loop.

This extension keeps Pi's cut-point calculation, recent-tail retention
(`firstKeptEntryId`), session persistence, `/compact`, and threshold machinery,
and replaces only the summary content:

```text
Pi:      preserve(S[n]) + delta → S[n+1]   (grows)
rewrite: rewrite_to_budget(S[n] ∪ delta) → S[n+1]   (bounded)
```

One `session_before_compact` hook, one nested LLM call per compaction, zero
tools / skills / commands / prompt-visible additions.

## Install

```bash
pi install git:github.com/exclamaforte/pi-rewrite-compact
```

Or try it once without installing:

```bash
pi --extension ./extensions/rewrite-compact.ts
```

## Configuration

| Env | Meaning |
|---|---|
| `PI_COMPACT_MODEL` | Optional `provider/model-id` for the rewrite call (e.g. `google/gemini-2.5-flash`). Must resolve with configured auth; otherwise ignored. |

Default: the session's own model is reused. The nested call runs under a fresh
session id with no prompt-cache writes, so current window pressure does not
apply to it.

Any failure (no model, empty output, aborted or errored call) returns
`undefined`, and Pi falls back to its default compaction. The extension never
blocks or cancels compaction.

## Checkpoint contract

The rewrite prompt demands at most 5,000 tokens, organized as:

- Current objective
- Current state
- Important findings/decisions
- Unresolved issues
- Relevant artifacts/files/beads
- Next actions

Rules: deduplicate aggressively; drop completed work unless its result
constrains future work; drop stale hypotheses and superseded decisions; never
preserve information merely because it was in the previous checkpoint. Beads is
authoritative for tasks/decisions; repo files are authoritative for experiment
results — the checkpoint names paths/artifacts instead of copying output.

Operator instructions from `/compact [...]` are forwarded as overriding
constraints on the rewrite.

## Develop

```bash
npm install
npm test    # vitest
npm run check  # tsc --noEmit
```

Layout: `extensions/rewrite-compact.ts` (hook wiring, pi imports),
`src/checkpoint.ts` (pure prompt/extraction logic), `test/` (vitest suites
for both, using mocked pi contexts — no live model needed).
