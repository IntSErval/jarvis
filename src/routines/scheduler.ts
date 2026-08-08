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
  for (const routine of dueRoutines(routines, at)) {
    // ponytail: swallow-and-continue — a personal single-user scheduler
    // shouldn't die because one routine failed.
    try {
      const channel = routine.channel ?? "routine:" + routine.id;
      const reply = await run(routine.prompt, channel);
      if (deliver) await deliver(routine, reply);
    } catch {
      // intentionally quiet; next tick / next routine carries on
    }
  }
}
