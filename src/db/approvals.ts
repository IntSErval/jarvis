// Approval log: the propose-and-park record for gated writes (Phase 4). A write
// tool never mutates directly — the orchestrator parks a `pending` Approval here
// and a human approves/denies it on the dashboard. Mirrors db/audit.ts:
// buildApproval is the pure normalizer, ApprovalStore is the injected port.

import { randomUUID } from "node:crypto";

// Lifecycle: pending -> approved -> executed | failed (or pending -> denied).
// "approved" means a human said yes; "executed"/"failed" record what the actual
// write then did, so a botched write never looks the same as a successful one.
export type ApprovalStatus = "pending" | "approved" | "denied" | "executed" | "failed";

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
  result?: unknown; // the write's return value once status === "executed"
  error?: string; // why the write failed once status === "failed"
}

/** Extra fields stamped alongside a status flip (execute outcome + clock inject). */
export interface SetStatusOpts {
  now?: () => Date;
  result?: unknown; // stamped on "executed"
  error?: string; // stamped on "failed"
}

/** Persistence port — file adapter injected at runtime, fake in tests. */
export interface ApprovalStore {
  insert(row: Approval): Promise<void>;
  recent(limit: number): Promise<Approval[]>;
  /** Flip status + stamp decided_at (and optional execute result/error).
   *  Resolves to the updated row, or undefined if no approval has that id. */
  setStatus(id: string, status: ApprovalStatus, opts?: SetStatusOpts): Promise<Approval | undefined>;
}

/** Runs one approved write by name, e.g. { notion_create_page: notionWriter.createPage }. */
export type ApprovalWriter = (args: unknown) => Promise<unknown>;

/** Dispatch an approved write to its registered writer (single enforcement seam,
 *  mirrors the orchestrator's read dispatch). Throws if the tool has no writer so
 *  the caller can flip the approval to "failed" — never a silent no-op. */
export async function executeApproval(
  approval: Approval,
  writers: Record<string, ApprovalWriter>,
): Promise<unknown> {
  const writer = writers[approval.tool];
  if (!writer) throw new Error(`no writer for tool: ${approval.tool}`);
  return writer(approval.args);
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
