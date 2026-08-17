// Dream log: the propose-and-park record for nightly dreaming (PRD 5.4). The
// dreamer samples memory, fans out candidate ideas, and parks each as a `new`
// DreamEntry here; a human accepts (promote) or dismisses (decay) it on the
// dashboard. Mirrors db/approvals.ts: buildDreamEntry is the pure normalizer,
// DreamStore is the injected port.

import { randomUUID } from "node:crypto";

/** PRD 5.4 categories. */
export type DreamCategory = "idea" | "reminder" | "contradiction" | "question";

// Lifecycle: new -> accepted (promoted to a task/note) | dismissed (decays).
export type DreamStatus = "new" | "accepted" | "dismissed";

export interface DreamInput {
  idea: string;
  /** The memory snippets this idea was drawn from (provenance). */
  sourceNotes: string[];
  /** Model's self-rated confidence, 0..1 (clamped). */
  confidence: number;
  category: DreamCategory;
}

export interface DreamEntry {
  id: string;
  ts: string; // ISO-8601 — when dreamed
  idea: string;
  sourceNotes: string[];
  confidence: number;
  category: DreamCategory;
  status: DreamStatus;
  decided_at: string | null; // ISO-8601 once accepted/dismissed
}

/** Persistence port — file adapter injected at runtime, fake in tests. */
export interface DreamStore {
  insert(row: DreamEntry): Promise<void>;
  recent(limit: number): Promise<DreamEntry[]>;
  /** Flip status + stamp decided_at. Resolves to the updated row, or undefined
   *  if no dream has that id. */
  setStatus(id: string, status: DreamStatus, now?: () => Date): Promise<DreamEntry | undefined>;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Normalize a raw proposal into a complete `new` DreamEntry (id + ts + defaults). */
export function buildDreamEntry(
  input: DreamInput,
  now: () => Date = () => new Date(),
  id: () => string = randomUUID,
): DreamEntry {
  return {
    id: id(),
    ts: now().toISOString(),
    idea: input.idea,
    sourceNotes: input.sourceNotes,
    confidence: clamp01(input.confidence),
    category: input.category,
    status: "new",
    decided_at: null,
  };
}
