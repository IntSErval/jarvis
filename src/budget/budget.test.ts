import { describe, it, expect } from "vitest";
import {
  costUsd,
  makeBudgetGuard,
  type BudgetStore,
  type SpendRecord,
} from "./budget.js";

// Fake in-memory store — the injected port, stubbed for tests.
function fakeStore(seed: SpendRecord[] = []): BudgetStore {
  const rows = [...seed];
  return {
    async record(entry) {
      rows.push(entry);
    },
    async spentSince(since) {
      const iso = since.toISOString();
      return rows.filter((r) => r.ts >= iso).reduce((sum, r) => sum + r.usd, 0);
    },
  };
}

describe("costUsd", () => {
  // Prices per-million tokens, from the claude-api skill (input/output):
  // opus-4-8 $5/$25, sonnet-5 $3/$15, haiku-4-5 $1/$5.
  it("prices a full 1M in + 1M out call for each known model", () => {
    expect(costUsd("claude-opus-4-8", 1_000_000, 1_000_000)).toBeCloseTo(30, 6);
    expect(costUsd("claude-sonnet-5", 1_000_000, 1_000_000)).toBeCloseTo(18, 6);
    expect(costUsd("claude-haiku-4-5", 1_000_000, 1_000_000)).toBeCloseTo(6, 6);
  });

  it("prices input and output tokens separately", () => {
    // opus: 500k in @ $5/M = $2.50, 200k out @ $25/M = $5.00
    expect(costUsd("claude-opus-4-8", 500_000, 200_000)).toBeCloseTo(7.5, 6);
  });

  it("falls back to Sonnet pricing for unknown models", () => {
    expect(costUsd("some-future-model", 1_000_000, 1_000_000)).toBeCloseTo(
      costUsd("claude-sonnet-5", 1_000_000, 1_000_000),
      6,
    );
  });

  it("is zero for a call with no tokens", () => {
    expect(costUsd("claude-opus-4-8", 0, 0)).toBe(0);
  });
});

describe("makeBudgetGuard", () => {
  const now = new Date("2026-08-17T12:00:00Z");

  it("allows when spend is under both caps and reports remaining", async () => {
    const guard = makeBudgetGuard(fakeStore([{ ts: now.toISOString(), usd: 2, model: "x" }]), {
      dailyUsd: 10,
      monthlyUsd: 100,
    });
    const check = await guard.check(now);
    expect(check.allow).toBe(true);
    expect(check.reason).toBeUndefined();
    expect(check.remainingDaily).toBeCloseTo(8, 6);
    expect(check.remainingMonthly).toBeCloseTo(98, 6);
  });

  it("denies at the daily cap", async () => {
    const guard = makeBudgetGuard(fakeStore([{ ts: now.toISOString(), usd: 10, model: "x" }]), {
      dailyUsd: 10,
      monthlyUsd: 100,
    });
    const check = await guard.check(now);
    expect(check.allow).toBe(false);
    expect(check.reason).toMatch(/daily/i);
    expect(check.remainingDaily).toBeCloseTo(0, 6);
  });

  it("denies over the monthly cap even when daily is fine", async () => {
    // Spread spend across the month so today's slice stays under the daily cap
    // but the month total exceeds the monthly cap.
    const guard = makeBudgetGuard(
      fakeStore([
        { ts: "2026-08-01T09:00:00Z", usd: 95, model: "x" },
        { ts: now.toISOString(), usd: 6, model: "x" },
      ]),
      { dailyUsd: 10, monthlyUsd: 100 },
    );
    const check = await guard.check(now);
    expect(check.allow).toBe(false);
    expect(check.reason).toMatch(/monthly/i);
  });

  it("allows unlimited when no caps are set", async () => {
    const guard = makeBudgetGuard(fakeStore([{ ts: now.toISOString(), usd: 9999, model: "x" }]), {});
    const check = await guard.check(now);
    expect(check.allow).toBe(true);
    expect(check.remainingDaily).toBeUndefined();
    expect(check.remainingMonthly).toBeUndefined();
  });

  it("treats an undefined cap as unlimited on that axis only", async () => {
    // Only a daily cap; monthly is unlimited.
    const guard = makeBudgetGuard(fakeStore([{ ts: now.toISOString(), usd: 3, model: "x" }]), {
      dailyUsd: 10,
    });
    const check = await guard.check(now);
    expect(check.allow).toBe(true);
    expect(check.remainingDaily).toBeCloseTo(7, 6);
    expect(check.remainingMonthly).toBeUndefined();
  });

  it("record delegates to the store", async () => {
    const store = fakeStore();
    const guard = makeBudgetGuard(store, { dailyUsd: 10 });
    await guard.record({ ts: now.toISOString(), usd: 4, model: "x" });
    // Spend since start-of-day should now reflect the recorded entry.
    const check = await guard.check(now);
    expect(check.remainingDaily).toBeCloseTo(6, 6);
  });
});
