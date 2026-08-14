// Approval log: the propose-and-park record for gated writes (Phase 4). A write
// tool never mutates directly — the orchestrator parks a `pending` Approval here
// and a human approves/denies it on the dashboard. Mirrors db/audit.ts:
// buildApproval is the pure normalizer, ApprovalStore is the injected port.

import { randomUUID } from "node:crypto";

export type ApprovalStatus = "pending" | "approved" | "denied";

export interface ApprovalInput {
  channel: string;
  /** Tool the model asked to run, e.g. "notion_create_page". */
  tool: string;
  args: unknown;
}

export interface Approval {
  id: string;
  ts: string; // ISO-8601 — when parked
  channel: string;
  tool: string;
  args: unknown;
  status: ApprovalStatus;
  decided_at: string | null; // ISO-8601 once approved/denied
}

/** Persistence port — file adapter injected at runtime, fake in tests. */
export interface ApprovalStore {
  insert(row: Approval): Promise<void>;
  recent(limit: number): Promise<Approval[]>;
  /** Flip status + stamp decided_at. Resolves to the updated row, or undefined
   *  if no approval has that id. */
  setStatus(id: string, status: ApprovalStatus, now?: () => Date): Promise<Approval | undefined>;
}

/** Normalize a raw input into a complete pending Approval (id + ts + defaults). */
export function buildApproval(
  input: ApprovalInput,
  now: () => Date = () => new Date(),
  id: () => string = randomUUID,
): Approval {
  return {
    id: id(),
    ts: now().toISOString(),
    channel: input.channel,
    tool: input.tool,
    args: input.args,
    status: "pending",
    decided_at: null,
  };
}
