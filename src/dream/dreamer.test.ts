import { describe, it, expect, vi } from "vitest";
import { runDreamer, type DreamerDeps } from "./dreamer.js";
import type { DreamEntry, DreamStore } from "./dream.js";
import type { ModelClient, Message } from "../orchestrator.js";
import type { MemoryStore, ScannedMemory } from "../memory/store.js";
import type { AuditInput } from "../db/audit.js";

function scriptedModel(texts: string[]): { model: ModelClient; calls: Message[][] } {
  const calls: Message[][] = [];
  let i = 0;
  return {
    calls,
    model: {
      turn: async (messages) => {
        calls.push(messages);
        return { toolCalls: [], text: texts[i++] ?? "" };
      },
    },
  };
}

function memoryWith(rows: ScannedMemory[]): MemoryStore {
  return {
    remember: async () => {},
    recall: async () => [],
    scan: async () => rows,
  };
}

function fakeDreamStore(): { store: DreamStore; inserted: DreamEntry[] } {
  const inserted: DreamEntry[] = [];
  return {
    inserted,
    store: {
      insert: async (row) => void inserted.push(row),
      recent: async (n) => inserted.slice(-n).reverse(),
      setStatus: async () => undefined,
    },
  };
}

const seed = (content: string): ScannedMemory => ({
  content,
  embedding: [Math.random(), Math.random()],
  metadata: {},
  created_at: "2026-08-10T00:00:00Z",
});

const candidates = (n: number) =>
  JSON.stringify(
    Array.from({ length: n }, (_, i) => ({
      idea: `idea ${i}`,
      sourceNotes: ["note"],
      confidence: 0.6,
      category: "idea",
    })),
  );

function baseDeps(over: Partial<DreamerDeps> = {}): DreamerDeps {
  const audits: AuditInput[] = [];
  const logAudit = vi.fn(async (a: AuditInput) => void audits.push(a));
  return {
    memory: memoryWith([seed("a"), seed("b")]),
    model: scriptedModel([candidates(2)]).model,
    dreams: fakeDreamStore().store,
    logAudit,
    now: () => new Date("2026-08-17T03:00:00Z"),
    id: (() => {
      let k = 0;
      return () => `dream-${k++}`;
    })(),
    ...over,
  };
}

describe("runDreamer", () => {
  it("fans out N proposal calls plus one judge call", async () => {
    const scripted = scriptedModel([
      "proposal 1",
      "proposal 2",
      candidates(1), // judge synthesis
    ]);
    const dreams = fakeDreamStore();
    await runDreamer(baseDeps({ model: scripted.model, dreams: dreams.store, proposals: 2 }));
    expect(scripted.calls.length).toBe(3); // 2 proposals + 1 judge
  });

  it("persists parsed candidates as DreamEntries and returns them", async () => {
    const scripted = scriptedModel(["p1", "p2", "p3", candidates(2)]);
    const dreams = fakeDreamStore();
    const out = await runDreamer(baseDeps({ model: scripted.model, dreams: dreams.store, proposals: 3 }));
    expect(out).toHaveLength(2);
    expect(dreams.inserted).toHaveLength(2);
    expect(dreams.inserted[0]!.status).toBe("new");
    expect(dreams.inserted[0]!.category).toBe("idea");
  });

  it("caps output to maxPerNight even if the judge returns more", async () => {
    const scripted = scriptedModel(["p1", "p2", "p3", candidates(9)]);
    const dreams = fakeDreamStore();
    const out = await runDreamer(baseDeps({ model: scripted.model, dreams: dreams.store, maxPerNight: 2 }));
    expect(out).toHaveLength(2);
    expect(dreams.inserted).toHaveLength(2);
  });

  it("does nothing (no model calls) when there are no memories to dream about", async () => {
    const scripted = scriptedModel([candidates(3)]);
    const out = await runDreamer(baseDeps({ memory: memoryWith([]), model: scripted.model }));
    expect(out).toEqual([]);
    expect(scripted.calls.length).toBe(0);
  });

  it("skips dreaming and audits when the budget guard denies", async () => {
    const scripted = scriptedModel([candidates(3)]);
    const dreams = fakeDreamStore();
    const audits: AuditInput[] = [];
    await runDreamer(
      baseDeps({
        model: scripted.model,
        dreams: dreams.store,
        logAudit: async (a) => void audits.push(a),
        budget: { check: async () => ({ allow: false, reason: "daily budget reached" }), record: async () => {} },
      }),
    );
    expect(scripted.calls.length).toBe(0);
    expect(dreams.inserted).toHaveLength(0);
    expect(audits.some((a) => /budget/i.test(a.response) || /budget/i.test(a.error ?? ""))).toBe(true);
  });

  it("degrades gracefully (returns [], no throw, audits error) when the judge output is unparseable", async () => {
    const scripted = scriptedModel(["p1", "p2", "p3", "this is not json at all"]);
    const dreams = fakeDreamStore();
    const audits: AuditInput[] = [];
    const out = await runDreamer(
      baseDeps({ model: scripted.model, dreams: dreams.store, logAudit: async (a) => void audits.push(a) }),
    );
    expect(out).toEqual([]);
    expect(dreams.inserted).toHaveLength(0);
    expect(audits.some((a) => a.status === "error")).toBe(true);
  });

  it("audits when sampling produces no seeds", async () => {
    const scripted = scriptedModel([candidates(3)]);
    const audits: AuditInput[] = [];
    const out = await runDreamer(
      baseDeps({
        memory: memoryWith([]),
        model: scripted.model,
        logAudit: async (a) => void audits.push(a),
      }),
    );
    expect(out).toEqual([]);
    expect(scripted.calls.length).toBe(0);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.response).toBe("skipped: no seeds");
    expect(audits[0]!.status).toBe("ok");
  });
});
