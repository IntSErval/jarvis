// Audit log: the record of every message Jarvis handles, shown on the dashboard.
// Phase 1 store is Supabase; buildAuditRow is the pure normalizer (unit-tested).

export type AuditStatus = "ok" | "error";

export interface ToolCallRecord {
  name: string;
  args: unknown;
  result?: unknown;
  error?: string;
}

export interface AuditInput {
  channel: string;
  user_msg: string;
  response: string;
  tool_calls?: ToolCallRecord[];
  status?: AuditStatus;
  error?: string | null;
}

export interface AuditRow {
  ts: string; // ISO-8601
  channel: string;
  user_msg: string;
  tool_calls: ToolCallRecord[];
  response: string;
  status: AuditStatus;
  error: string | null;
}

/** Persistence port — Supabase adapter injected at runtime, fake in tests. */
export interface AuditStore {
  insert(row: AuditRow): Promise<void>;
  recent(limit: number): Promise<AuditRow[]>;
}

/** Normalize a raw audit input into a complete row (defaults + timestamp). */
export function buildAuditRow(
  input: AuditInput,
  now: () => Date = () => new Date(),
): AuditRow {
  return {
    ts: now().toISOString(),
    channel: input.channel,
    user_msg: input.user_msg,
    tool_calls: input.tool_calls ?? [],
    response: input.response,
    status: input.status ?? "ok",
    error: input.error ?? null,
  };
}

/** Returns a logAudit(input) bound to a store — this is the orchestrator's dep. */
export function makeAuditLogger(store: AuditStore, now: () => Date = () => new Date()) {
  return (input: AuditInput): Promise<void> => store.insert(buildAuditRow(input, now));
}
