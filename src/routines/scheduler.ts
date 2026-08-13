// Cron-triggered routines: filter routines due at a given time, run each
// through the orchestrator, and optionally deliver the reply somewhere.

import type { Routine } from "./routines.js";
import { cronMatches } from "./cron.js";

export function dueRoutines(routines: Routine[], at: Date): Routine[] {
  return routines.filter((r) => cronMatches(r.schedule, at));
}

export async function runDueRoutines(
  routines: Routine[],
  at: Date,
  run: (prompt: string, channel: string) => Promise<string>,
  deliver?: (routine: Routine, reply: string) => Promise<void>,
): Promise<void> {
  for (const routine of routines) {
    // ponytail: swallow-and-continue — a personal single-user scheduler
    // shouldn't die because one routine failed. The due-check lives INSIDE the
    // try so a throwing schedule (bad cron expr) is isolated like a failing run,
    // never rejecting the batch (server.ts void-s this with no .catch).
    try {
      if (!cronMatches(routine.schedule, at)) continue;
      const channel = routine.channel ?? `routine:${routine.id}`;
      const reply = await run(routine.prompt, channel);
      if (deliver) await deliver(routine, reply);
    } catch {
      // intentionally quiet; next tick / next routine carries on
    }
  }
}
