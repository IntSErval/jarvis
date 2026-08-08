// Routine definitions loaded from a JSON file — the schedule source for the
// cron scheduler. No DB table for this; a single file is enough for one user.

import { readFile } from "node:fs/promises";

export interface Routine {
  id: string;
  schedule: string; // 5-field cron expression
  prompt: string; // sent to the orchestrator as the user text
  channel?: string; // audit channel tag; defaults to "routine:<id>"
}

export async function loadRoutines(path: string): Promise<Routine[]> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Routine[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
