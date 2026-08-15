// Local, zero-account ApprovalStore: the whole approval log is one JSON array on
// disk. Free walking-skeleton persistence — swap in a Supabase adapter (same
// ApprovalStore port) when you want a hosted dashboard. Mirrors fileAudit.ts.

import { readFile, writeFile } from "node:fs/promises";
import type { Approval, ApprovalStore, ApprovalStatus, SetStatusOpts } from "../db/approvals.js";

export function fileApprovalStore(path: string): ApprovalStore {
  async function readAll(): Promise<Approval[]> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as Approval[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  // ponytail: read-modify-write the whole file per op — fine for one personal
  // user. Move to append-only JSONL or SQLite if it grows/concurrent.
  return {
    insert: async (row) => {
      const rows = await readAll();
      rows.push(row);
      await writeFile(path, JSON.stringify(rows, null, 2), "utf8");
    },
    recent: async (limit) => (await readAll()).slice(-limit).reverse(),
    setStatus: async (id, status: ApprovalStatus, opts: SetStatusOpts = {}) => {
      const { now = () => new Date(), result, error } = opts;
      const rows = await readAll();
      const found = rows.find((r) => r.id === id);
      if (!found) return undefined;
      found.status = status;
      found.decided_at = now().toISOString();
      if (result !== undefined) found.result = result;
      if (error !== undefined) found.error = error;
      await writeFile(path, JSON.stringify(rows, null, 2), "utf8");
      return found;
    },
  };
}
