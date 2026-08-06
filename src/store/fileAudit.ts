// Local, zero-account AuditStore: the whole log is one JSON array on disk.
// This is the free walking-skeleton persistence; swap in the Supabase adapter
// (same AuditStore port) when you actually want a hosted dashboard.

import { readFile, writeFile } from "node:fs/promises";
import type { AuditRow, AuditStore } from "../db/audit.js";

export function fileAuditStore(path: string): AuditStore {
  async function readAll(): Promise<AuditRow[]> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as AuditRow[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  return {
    // ponytail: read-modify-write the whole file per insert — fine for one
    // personal user. Move to append-only JSONL or SQLite if it grows/concurrent.
    insert: async (row) => {
      const rows = await readAll();
      rows.push(row);
      await writeFile(path, JSON.stringify(rows, null, 2), "utf8");
    },
    recent: async (limit) => (await readAll()).slice(-limit).reverse(),
  };
}
