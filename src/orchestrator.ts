// The Foundation loop: message -> model -> (read-only calendar tool) -> response,
// every exchange logged for the dashboard. Deps are injected so the loop is
// unit-testable without live model/calendar/db.

import type { AuditInput, ToolCallRecord } from "./db/audit.js";

export interface OrchestratorInput {
  text: string;
  channel: string;
}

export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
}

export interface ModelToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface ModelTurn {
  /** Empty => the model is done and `text` is the final answer. */
  toolCalls: ModelToolCall[];
  text: string;
}

export interface ToolSpec {
  name: string;
  description: string;
}

export interface ModelClient {
  turn(messages: Message[], tools: ToolSpec[]): Promise<ModelTurn>;
}

/** Read-only calendar surface — least privilege (PRD 5.2). No write methods. */
export interface CalendarClient {
  listEvents(args: unknown): Promise<unknown>;
  getEvent(args: unknown): Promise<unknown>;
}

export interface OrchestratorDeps {
  model: ModelClient;
  calendar: CalendarClient;
  logAudit: (input: AuditInput) => Promise<void>;
  /** Max model<->tool round trips before bailing (PRD 8 max-hop guard). */
  maxHops?: number;
}

export const CALENDAR_TOOLS: ToolSpec[] = [
  { name: "list_events", description: "List calendar events in a time range (read-only)." },
  { name: "get_event", description: "Get one calendar event by id (read-only)." },
];

export async function runOrchestrator(
  _input: OrchestratorInput,
  _deps: OrchestratorDeps,
): Promise<string> {
  throw new Error("not implemented");
}

export type { ToolCallRecord };
