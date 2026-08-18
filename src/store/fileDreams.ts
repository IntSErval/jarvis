// Local, zero-account DreamStore: the whole dream journal is one JSON array on
// disk. Free walking-skeleton persistence — swap in a Supabase adapter (same
// DreamStore port) when you want a hosted dashboard. Mirrors fileApprovals.ts.

import { readFile, writeFile } from "node:fs/promises";
import type { DreamEntry, DreamStore, DreamStatus } from "../dream/dream.js";

export function fileDreamStore(path: string): DreamStore {
  async function readAll(): Promise<DreamEntry[]> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as DreamEntry[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  // ponytail: read-modify-write the whole file per op — fine for one personal
  // user (a handful of dreams a night). Move to JSONL/SQLite if it grows.
  return {
    insert: async (row) => {
      const rows = await readAll();
      rows.push(row);
      await writeFile(path, JSON.stringify(rows, null, 2), "utf8");
    },
    recent: async (limit) => (await readAll()).slice(-limit).reverse(),
    setStatus: async (id, status: DreamStatus, now = () => new Date()) => {
      const rows = await readAll();
      const found = rows.find((r) => r.id === id);
      if (!found) return undefined;
      found.status = status;
      found.decided_at = now().toISOString();
      await writeFile(path, JSON.stringify(rows, null, 2), "utf8");
      return found;
    },
  };
}
