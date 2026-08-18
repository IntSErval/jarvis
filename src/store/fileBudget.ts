// Local, zero-account BudgetStore: spend records persist as a JSON array on disk.
// Spend windows survive process restarts, so BudgetGuard caps work across
// autonomous runs. This is the free walking-skeleton persistence; swap in a
// database adapter (same BudgetStore port) if you need distributed/multi-account accounting.

import { readFile, writeFile } from "node:fs/promises";
import type { BudgetStore, SpendRecord } from "../budget/budget.js";

export function fileBudgetStore(path: string): BudgetStore {
  async function readAll(): Promise<SpendRecord[]> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as SpendRecord[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  return {
    // ponytail: read-modify-write the whole file per insert — fine for one
    // personal user. Move to append-only JSONL or SQLite if it grows/concurrent.
    record: async (entry) => {
      const records = await readAll();
      records.push(entry);
      await writeFile(path, JSON.stringify(records, null, 2), "utf8");
    },
    spentSince: async (since) => {
      const records = await readAll();
      const sinceIso = since.toISOString();
      return records
        .filter((r) => r.ts >= sinceIso)
        .reduce((sum, r) => sum + r.usd, 0);
    },
  };
}
