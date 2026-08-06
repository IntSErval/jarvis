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

const GRACEFUL = "Sorry, I couldn't complete that — I hit an error.";

/** Dispatch a tool call to the read-only calendar surface. Unknown name => throw. */
function dispatchTool(calendar: CalendarClient, name: string, args: unknown): Promise<unknown> {
  switch (name) {
    case "list_events":
      return calendar.listEvents(args);
    case "get_event":
      return calendar.getEvent(args);
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

export async function runOrchestrator(
  input: OrchestratorInput,
  deps: OrchestratorDeps,
): Promise<string> {
  const { model, calendar, logAudit, maxHops = 4 } = deps;
  const messages: Message[] = [{ role: "user", content: input.text }];
  const toolCalls: ToolCallRecord[] = [];

  const finish = (response: string, status: "ok" | "error", error?: string) =>
    logAudit({ channel: input.channel, user_msg: input.text, response, tool_calls: toolCalls, status, error })
      .then(() => response);

  try {
    for (let hop = 0; hop < maxHops; hop++) {
      const turn = await model.turn(messages, CALENDAR_TOOLS);

      if (turn.toolCalls.length === 0) {
        return await finish(turn.text, "ok");
      }

      for (const call of turn.toolCalls) {
        try {
          const result = await dispatchTool(calendar, call.name, call.args);
          toolCalls.push({ name: call.name, args: call.args, result });
          messages.push({ role: "assistant", content: "", toolCallId: call.id });
          messages.push({ role: "tool", content: JSON.stringify(result), toolCallId: call.id });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toolCalls.push({ name: call.name, args: call.args, error: msg });
          return await finish(GRACEFUL, "error", msg);
        }
      }
    }
    return await finish(GRACEFUL, "error", `max hops (${maxHops}) exceeded`);
  } catch (err) {
    // Model call (or logging) blew up — degrade gracefully, still record it.
    const msg = err instanceof Error ? err.message : String(err);
    return await finish(GRACEFUL, "error", msg);
  }
}

export type { ToolCallRecord };
