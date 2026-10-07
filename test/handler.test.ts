import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import factory from "../extensions/rewrite-compact.js";

type Handler = (event: any, ctx: any) => Promise<{ compaction: any } | undefined>;

function runFactory() {
  let captured: Handler | undefined;
  const pi = {
    on: vi.fn((_event: string, handler: Handler) => {
      captured = handler;
      return () => {};
    }),
  };
  (factory as (pi: unknown) => void)(pi as unknown as ExtensionAPI);
  if (!captured) throw new Error("handler was not registered");
  return captured;
}

function makeCtx(overrides: Record<string, any> = {}) {
  return {
    getModel: () => ({ id: "session-model" }),
    model: { id: "session-model" },
    modelRegistry: {
      find: () => undefined,
      hasConfiguredAuth: () => false,
      complete: async () => ({
        content: [{ type: "text", text: "checkpoint summary" }],
        usage: { input: 10, output: 5 },
      }),
    },
    ui: { notify: () => {} },
    ...overrides,
  };
}

function makeEvent() {
  return {
    preparation: {
      messagesToSummarize: [],
      turnPrefixMessages: [],
      tokensBefore: 200000,
      firstKeptEntryId: "keep-123",
      previousSummary: "old checkpoint",
    },
    customInstructions: undefined,
    signal: undefined,
  };
}

afterEach(() => {
  delete process.env["PI_COMPACT_MODEL"];
});

describe("session_before_compact wiring", () => {
  it("registers on session_before_compact and returns Pi's cut-point fields untouched", async () => {
    const handler = runFactory();
    const complete = vi.fn(async () => ({
      content: [{ type: "text", text: "fresh checkpoint" }],
      usage: { input: 1, output: 1 },
    }));
    const ctx = makeCtx({ modelRegistry: { complete } });
    const result = await handler(makeEvent(), ctx);
    expect(result?.compaction.summary).toBe("fresh checkpoint");
    expect(result?.compaction.firstKeptEntryId).toBe("keep-123");
    expect(result?.compaction.tokensBefore).toBe(200000);
    expect(result?.compaction.usage).toEqual({ input: 1, output: 1 });
  });

  it("sends the previous checkpoint into the nested call", async () => {
    const handler = runFactory();
    let sent: any;
    const complete = vi.fn(async (_model: any, context: any) => {
      sent = context;
      return { content: [{ type: "text", text: "ok" }] };
    });
    await handler(makeEvent(), makeCtx({ modelRegistry: { complete } }));
    const text = sent.messages[0].content[0].text as string;
    expect(text).toContain("<previous-checkpoint>\nold checkpoint\n</previous-checkpoint>");
    expect(text).toContain("REPLACES the previous checkpoint");
  });

  it("falls back to default compaction on empty output", async () => {
    const handler = runFactory();
    const ctx = makeCtx({
      modelRegistry: {
        complete: async () => ({ content: [{ type: "text", text: "   " }] }),
      },
    });
    expect(await handler(makeEvent(), ctx)).toBeUndefined();
  });

  it("falls back to default compaction when the nested call throws", async () => {
    const handler = runFactory();
    const ctx = makeCtx({
      modelRegistry: {
        complete: async () => {
          throw new Error("provider down");
        },
      },
    });
    expect(await handler(makeEvent(), ctx)).toBeUndefined();
  });

  it("falls back to default compaction when no model is available", async () => {
    const handler = runFactory();
    const ctx = makeCtx({ getModel: () => undefined, model: undefined });
    expect(await handler(makeEvent(), ctx)).toBeUndefined();
  });

  it("prefers PI_COMPACT_MODEL when it resolves with auth", async () => {
    process.env["PI_COMPACT_MODEL"] = "cheap/fast";
    const handler = runFactory();
    let used: any;
    const ctx = makeCtx({
      modelRegistry: {
        find: (provider: string, modelId: string) =>
          provider === "cheap" && modelId === "fast" ? { id: "cheap/fast" } : undefined,
        hasConfiguredAuth: () => true,
        complete: async (model: any) => {
          used = model;
          return { content: [{ type: "text", text: "ok" }] };
        },
      },
    });
    const result = await handler(makeEvent(), ctx);
    expect(used).toEqual({ id: "cheap/fast" });
    expect(result?.compaction.summary).toBe("ok");
  });

  it("ignores PI_COMPACT_MODEL without auth and uses the session model", async () => {
    process.env["PI_COMPACT_MODEL"] = "cheap/fast";
    const handler = runFactory();
    let used: any;
    const ctx = makeCtx({
      modelRegistry: {
        find: () => ({ id: "cheap/fast" }),
        hasConfiguredAuth: () => false,
        complete: async (model: any) => {
          used = model;
          return { content: [{ type: "text", text: "ok" }] };
        },
      },
    });
    await handler(makeEvent(), ctx);
    expect(used).toEqual({ id: "session-model" });
  });
});
