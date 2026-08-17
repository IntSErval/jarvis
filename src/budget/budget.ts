// Cost meter + budget guard for autonomous runs (Phase 6). Pure pricing
// (`costUsd`) plus an injected-port guard (`makeBudgetGuard`) that decides
// whether a run may proceed under daily/monthly USD caps. Mirrors
// db/approvals.ts: pure function + type-only port, no live services.

/** Per-million-token prices (input, output) — from the claude-api skill. */
interface Price {
  in: number;
  out: number;
}

// ponytail: prices as of the claude-api skill snapshot (2026-06-24). Sonnet 5
// has a lower intro price through 2026-08-31; we bill the durable standard
// rate so the meter doesn't silently under-report once intro pricing ends.
const PRICING: Record<string, Price> = {
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

// ponytail: unknown models fall back to Sonnet pricing — a sane mid-tier
// default so a new model id meters non-zero instead of free.
const FALLBACK: Price = PRICING["claude-sonnet-5"]!;

/** USD cost of one model call. Input/output tokens priced separately. */
export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING[model] ?? FALLBACK;
  return (inputTokens * price.in + outputTokens * price.out) / 1_000_000;
}

export interface SpendRecord {
  ts: string;
  usd: number;
  model: string;
}

export interface BudgetStore {
  record(entry: SpendRecord): Promise<void>;
  /** Sum of usd for records with ts >= since (ISO-8601 compare is fine). */
  spentSince(since: Date): Promise<number>;
}

export interface BudgetCaps {
  dailyUsd?: number;
  monthlyUsd?: number;
}

export interface BudgetCheck {
  allow: boolean;
  reason?: string;
  remainingDaily?: number;
  remainingMonthly?: number;
}

export interface BudgetGuard {
  /** May an autonomous run proceed under the caps as of `now`? */
  check(now?: Date): Promise<BudgetCheck>;
  record(entry: SpendRecord): Promise<void>;
}

// Local-time day/month boundaries — spend windows track the operator's wall
// clock, not UTC, so "daily" means their day.
function startOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function makeBudgetGuard(store: BudgetStore, caps: BudgetCaps): BudgetGuard {
  return {
    async check(now = new Date()): Promise<BudgetCheck> {
      const result: BudgetCheck = { allow: true };

      if (caps.dailyUsd !== undefined) {
        const spent = await store.spentSince(startOfDay(now));
        result.remainingDaily = caps.dailyUsd - spent;
        if (spent >= caps.dailyUsd) {
          result.allow = false;
          result.reason = "daily budget reached";
        }
      }

      if (caps.monthlyUsd !== undefined) {
        const spent = await store.spentSince(startOfMonth(now));
        result.remainingMonthly = caps.monthlyUsd - spent;
        if (spent >= caps.monthlyUsd) {
          result.allow = false;
          result.reason = "monthly budget reached";
        }
      }

      return result;
    },
    record(entry: SpendRecord): Promise<void> {
      return store.record(entry);
    },
  };
}
