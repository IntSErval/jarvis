// The Foundation loop: message -> model -> (read-only calendar tool) -> response,
// every exchange logged for the dashboard. Deps are injected so the loop is
// unit-testable without live model/calendar/db.

import type { AuditInput, ToolCallRecord } from "./db/audit.js";
import { allowlistGate, type Gate } from "./gate.js";
import type { GithubClient } from "./github/github.js";
import type { GmailClient } from "./mail/gmail.js";
import type { NotionClient } from "./notion/notion.js";
import type { MemoryStore } from "./memory/store.js";

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
  /** Optional read-only GitHub surface. When present, its tools are exposed to
   *  the model and permitted by the default gate; absent => deny-by-default. */
  github?: GithubClient;
  /** Optional read-only Gmail surface. When present, its tools are exposed to
   *  the model and permitted by the default gate; absent => deny-by-default. */
  gmail?: GmailClient;
  /** Optional read-only Notion surface. When present, its tools are exposed to
   *  the model and permitted by the default gate; absent => deny-by-default. */
  notion?: NotionClient;
  /** Optional semantic-memory surface. When present, the read-only
   *  `memory_search` tool is exposed and permitted; absent => deny-by-default. */
  memory?: MemoryStore;
  logAudit: (input: AuditInput) => Promise<void>;
  /** Max model<->tool round trips before bailing (PRD 8 max-hop guard). */
  maxHops?: number;
  /** Permission gate consulted before every tool call. Defaults to an
   *  allowlist of the wired read-only tools (least privilege). */
  gate?: Gate;
}

export const CALENDAR_TOOLS: ToolSpec[] = [
  { name: "list_events", description: "List calendar events in a time range (read-only)." },
  { name: "get_event", description: "Get one calendar event by id (read-only)." },
];

export const GITHUB_TOOLS: ToolSpec[] = [
  { name: "list_issues", description: "List issues in a GitHub repo (read-only)." },
  { name: "get_issue", description: "Get one GitHub issue by number (read-only)." },
  { name: "get_file", description: "Read a file's contents from a GitHub repo (read-only)." },
];

export const GMAIL_TOOLS: ToolSpec[] = [
  { name: "list_messages", description: "List Gmail messages matching a query (read-only)." },
  { name: "get_message", description: "Get one Gmail message by id (read-only)." },
];

export const NOTION_TOOLS: ToolSpec[] = [
  // notion_search is deliberately prefixed to avoid colliding with any future generic `search` tool.
  { name: "notion_search", description: "Search Notion pages and databases (read-only)." },
  { name: "get_page", description: "Get one Notion page by id (read-only)." },
  { name: "get_block_children", description: "List the child blocks of a Notion block or page (read-only)." },
];

export const MEMORY_TOOLS: ToolSpec[] = [
  {
    name: "memory_search",
    description:
      "Semantically recall Jarvis's own past memories relevant to a query (read-only, RAG-style — returns the top matches, not a full dump). Args: { query: string, k?: number }.",
  },
];

const GRACEFUL = "Sorry, I couldn't complete that — I hit an error.";

/** Build the tool name -> handler map from whichever read-only clients are wired.
 *  Adding a capability is a new adapter here + server.ts wiring — not loop surgery. */
function buildDispatch(deps: OrchestratorDeps): Map<string, (args: unknown) => Promise<unknown>> {
  const dispatch = new Map<string, (args: unknown) => Promise<unknown>>([
    ["list_events", (a) => deps.calendar.listEvents(a)],
    ["get_event", (a) => deps.calendar.getEvent(a)],
  ]);
  if (deps.github) {
    const gh = deps.github;
    dispatch.set("list_issues", (a) => gh.listIssues(a));
    dispatch.set("get_issue", (a) => gh.getIssue(a));
    dispatch.set("get_file", (a) => gh.getFile(a));
  }
  if (deps.gmail) {
    const gmail = deps.gmail;
    dispatch.set("list_messages", (a) => gmail.listMessages(a));
    dispatch.set("get_message", (a) => gmail.getMessage(a));
  }
  if (deps.notion) {
    const notion = deps.notion;
    dispatch.set("notion_search", (a) => notion.search(a));
    dispatch.set("get_page", (a) => notion.getPage(a));
    dispatch.set("get_block_children", (a) => notion.getBlockChildren(a));
  }
  if (deps.memory) {
    const memory = deps.memory;
    // recall(query, k) — unlike the single-arg clients, so unpack the tool args.
    dispatch.set("memory_search", (a) => {
      const { query, k } = (a ?? {}) as { query?: string; k?: number };
      if (!query) throw new Error("memory_search: query is required");
      return k === undefined ? memory.recall(query) : memory.recall(query, k);
    });
  }
  return dispatch;
}

export async function runOrchestrator(
  input: OrchestratorInput,
  deps: OrchestratorDeps,
): Promise<string> {
  const { model, logAudit, maxHops = 4 } = deps;
  const dispatch = buildDispatch(deps);
  // Only expose tools that are actually wired (least privilege).
  const tools: ToolSpec[] = [
    ...CALENDAR_TOOLS,
    ...(deps.github ? GITHUB_TOOLS : []),
    ...(deps.gmail ? GMAIL_TOOLS : []),
    ...(deps.notion ? NOTION_TOOLS : []),
    ...(deps.memory ? MEMORY_TOOLS : []),
  ];
  const gate = deps.gate ?? allowlistGate([...dispatch.keys()]);
  const messages: Message[] = [{ role: "user", content: input.text }];
  const toolCalls: ToolCallRecord[] = [];

  const finish = (response: string, status: "ok" | "error", error?: string) =>
    logAudit({ channel: input.channel, user_msg: input.text, response, tool_calls: toolCalls, status, error })
      .then(() => response);

  try {
    for (let hop = 0; hop < maxHops; hop++) {
      const turn = await model.turn(messages, tools);

      if (turn.toolCalls.length === 0) {
        return await finish(turn.text, "ok");
      }

      for (const call of turn.toolCalls) {
        const decision = gate.check({ name: call.name, args: call.args });
        if (!decision.allow) {
          const reason = decision.reason ?? `tool not permitted: ${call.name}`;
          toolCalls.push({ name: call.name, args: call.args, error: reason });
          return await finish(GRACEFUL, "error", reason);
        }
        try {
          const handler = dispatch.get(call.name);
          if (!handler) throw new Error(`unknown tool: ${call.name}`);
          const result = await handler(call.args);
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
