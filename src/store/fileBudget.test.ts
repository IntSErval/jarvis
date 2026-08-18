import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileBudgetStore } from "./fileBudget.js";
import type { SpendRecord } from "../budget/budget.js";

function record(overrides: Partial<SpendRecord> = {}): SpendRecord {
  return {
    ts: "2026-08-18T09:00:00.000Z",
    usd: 0.05,
    model: "claude-sonnet-5",
    ...overrides,
  };
}

describe("fileBudgetStore", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jarvis-budget-"));
    path = join(dir, "budget.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns 0 spend when the file does not exist yet", async () => {
    const store = fileBudgetStore(path);
    const since = new Date("2026-08-18T00:00:00.000Z");
    expect(await store.spentSince(since)).toBe(0);
  });

  it("records a spend entry and sums it correctly", async () => {
    const store = fileBudgetStore(path);
    await store.record(record({ usd: 0.05 }));

    const since = new Date("2026-08-18T00:00:00.000Z");
    expect(await store.spentSince(since)).toBe(0.05);
  });

  it("sums multiple records correctly", async () => {
    const store = fileBudgetStore(path);
    await store.record(record({ usd: 0.05, ts: "2026-08-18T09:00:00.000Z" }));
    await store.record(record({ usd: 0.1, ts: "2026-08-18T10:00:00.000Z" }));
    await store.record(record({ usd: 0.02, ts: "2026-08-18T11:00:00.000Z" }));

    const since = new Date("2026-08-18T00:00:00.000Z");
    expect(await store.spentSince(since)).toBe(0.17);
  });

  it("excludes records with ts strictly before since (boundary: equal is included)", async () => {
    const store = fileBudgetStore(path);
    // Record before the boundary
    await store.record(
      record({ usd: 0.05, ts: "2026-08-17T23:59:59.999Z" })
    );
    // Record exactly at the boundary
    await store.record(
      record({ usd: 0.1, ts: "2026-08-18T00:00:00.000Z" })
    );
    // Record after the boundary
    await store.record(
      record({ usd: 0.02, ts: "2026-08-18T00:00:00.001Z" })
    );

    const since = new Date("2026-08-18T00:00:00.000Z");
    // Should include the record at exactly 00:00:00.000Z and after, exclude the one before
    expect(await store.spentSince(since)).toBeCloseTo(0.12);
  });

  it("persists to disk and survives a reload", async () => {
    await fileBudgetStore(path).record(
      record({ usd: 0.05, ts: "2026-08-18T09:00:00.000Z" })
    );

    // Reopen with a fresh store
    const reopened = fileBudgetStore(path);
    const since = new Date("2026-08-18T00:00:00.000Z");
    expect(await reopened.spentSince(since)).toBe(0.05);
  });

  it("tracks spend across multiple models", async () => {
    const store = fileBudgetStore(path);
    await store.record(
      record({ usd: 0.05, model: "claude-sonnet-5" })
    );
    await store.record(
      record({ usd: 0.1, model: "claude-opus-4-8" })
    );
    await store.record(
      record({ usd: 0.02, model: "claude-haiku-4-5" })
    );

    const since = new Date("2026-08-18T00:00:00.000Z");
    expect(await store.spentSince(since)).toBe(0.17);
  });
});
