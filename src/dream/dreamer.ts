// The dreaming pipeline (PRD 5.4). A nightly, autonomous pass: sample the most
// "dream-worthy" memories, fan out N independent proposal calls, run one judge/
// synthesis pass to pick the best few, park them as `new` DreamEntries, and
// audit the run. Entirely best-effort — a bad model response or a down store
// must never throw into the caller (the scheduler).
//
// Reuses the injected ModelClient port (empty tool list => plain generation) and
// the audit logger, exactly like the orchestrator loop. Not loop surgery.

import type { ModelClient, Message } from "../orchestrator.js";
import type { MemoryStore } from "../memory/store.js";
import type { AuditInput } from "../db/audit.js";
import type { BudgetGuard } from "../budget/budget.js";
import { buildDreamEntry, type DreamEntry, type DreamInput, type DreamStore, type DreamCategory } from "./dream.js";
import { sampleSeeds } from "./sample.js";

export interface DreamerDeps {
  memory: MemoryStore;
  model: ModelClient;
  dreams: DreamStore;
  logAudit: (input: AuditInput) => Promise<void>;
  /** Autonomous-loop cost cap (PRD 8). Absent => unbounded (still bounded by maxPerNight). */
  budget?: BudgetGuard;
  /** Independent proposal calls fanned out before the judge pass. */
  proposals?: number;
  /** Hard cap on ideas persisted per run (PRD 5.4 "ideas/day" cap). */
  maxPerNight?: number;
  /** How many memories to seed the proposals with. */
  seeds?: number;
  now?: () => Date;
  id?: () => string;
}

const CATEGORIES = new Set<DreamCategory>(["idea", "reminder", "contradiction", "question"]);

function seedBlock(seeds: string[]): string {
  return seeds.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

const proposalPrompt = (seeds: string[]): Message => ({
  role: "user",
  content:
    "You are Jarvis dreaming over your own memory. From these notes, propose ONE non-obvious " +
    "connection, contradiction, reminder, or follow-up question worth surfacing to the user. " +
    "Be specific and grounded in the notes.\n\nNotes:\n" +
    seedBlock(seeds),
});

const judgePrompt = (proposals: string[]): Message => ({
  role: "user",
  content:
    "Here are candidate dream ideas. Pick the best, most useful and non-duplicative ones and return " +
    'ONLY a JSON array. Each item: {"idea": string, "sourceNotes": string[], "confidence": number 0..1, ' +
    '"category": "idea"|"reminder"|"contradiction"|"question"}. No prose, just the array.\n\nCandidates:\n' +
    proposals.map((p, i) => `--- candidate ${i + 1} ---\n${p}`).join("\n\n"),
});

/** Best-effort extraction of a JSON array from a model reply (may be fenced or
 *  wrapped in prose). Throws if no array is found or it doesn't parse. */
function parseCandidates(text: string): DreamInput[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) throw new Error("no JSON array in judge output");
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("judge output is not an array");
  return parsed
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .filter((c) => typeof c.idea === "string" && CATEGORIES.has(c.category as DreamCategory))
    .map((c) => ({
      idea: c.idea as string,
      sourceNotes: Array.isArray(c.sourceNotes) ? (c.sourceNotes as unknown[]).map(String) : [],
      confidence: typeof c.confidence === "number" ? c.confidence : 0.5,
      category: c.category as DreamCategory,
    }));
}

/** Run one dreaming pass. Returns the persisted entries ([] if it produced or
 *  could persist nothing). Never throws. */
export async function runDreamer(deps: DreamerDeps): Promise<DreamEntry[]> {
  const { memory, model, dreams, logAudit, budget, proposals = 3, maxPerNight = 5, seeds = 8, now, id } = deps;

  const audit = (input: Partial<AuditInput> & Pick<AuditInput, "response" | "status">) =>
    logAudit({ channel: "dream", user_msg: "dream", tool_calls: [], ...input });

  try {
    if (budget) {
      const decision = await budget.check(now?.());
      if (!decision.allow) {
        await audit({ response: `skipped: budget (${decision.reason ?? "cap reached"})`, status: "ok" });
        return [];
      }
    }

    const scanned = await memory.scan();
    const chosen = sampleSeeds(scanned, seeds, now?.());
    if (chosen.length === 0) {
      await audit({ response: "skipped: no seeds", status: "ok" });
      return [];
    }
    const seedTexts = chosen.map((m) => m.content);

    // Fan out N independent proposals, then one judge/synthesis pass.
    const proposalTexts: string[] = [];
    for (let i = 0; i < proposals; i++) {
      const turn = await model.turn([proposalPrompt(seedTexts)], []);
      proposalTexts.push(turn.text);
    }
    const judged = await model.turn([judgePrompt(proposalTexts)], []);

    const inputs = parseCandidates(judged.text).slice(0, maxPerNight);
    const entries = inputs.map((input) => buildDreamEntry(input, now, id));
    for (const entry of entries) await dreams.insert(entry);

    await audit({ response: `dreamed ${entries.length}`, status: "ok" });
    return entries;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await audit({ response: "dream failed", status: "error", error: msg });
    return [];
  }
}
