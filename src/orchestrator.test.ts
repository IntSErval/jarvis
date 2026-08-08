import { describe, it, expect, vi } from "vitest";
import {
  runOrchestrator,
  type CalendarClient,
  type ModelClient,
  type ModelTurn,
  type OrchestratorDeps,
} from "./orchestrator.js";
import type { AuditInput } from "./db/audit.js";
import { allowlistGate } from "./gate.js";

/** Model that replays a scripted sequence of turns, repeating the last one. */
function scriptedModel(turns: ModelTurn[]): ModelClient {
  let i = 0;
  return {
    turn: async () => turns[Math.min(i++, turns.length - 1)] ?? { toolCalls: [], text: "" },
  };
}

const okCalendar: CalendarClient = {
  listEvents: async () => [],
  getEvent: async () => ({}),
};

function harness(overrides: Partial<OrchestratorDeps> = {}) {
  const audits: AuditInput[] = [];
  const deps: OrchestratorDeps = {
    model: scriptedModel([{ toolCalls: [], text: "" }]),
    calendar: okCalendar,
    logAudit: async (a) => {
      audits.push(a);
    },
    ...overrides,
  };
  return { audits, deps };
}

describe("runOrchestrator", () => {
  it("returns the model's answer and logs one ok audit row when no tool is used", async () => {
    const { audits, deps } = harness({
      model: scriptedModel([{ toolCalls: [], text: "It's sunny." }]),
    });

    const out = await runOrchestrator({ text: "how's the weather", channel: "web" }, deps);

    expect(out).toBe("It's sunny.");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ status: "ok", channel: "web", user_msg: "how's the weather" });
    expect(audits[0]!.tool_calls).toEqual([]);
  });

  it("runs a calendar tool call, feeds the result back, and records it", async () => {
    const events = [{ id: "1", summary: "Standup" }];
    const listEvents = vi.fn(async () => events);
    const { audits, deps } = harness({
      model: scriptedModel([
        { toolCalls: [{ id: "t1", name: "list_events", args: { day: "tomorrow" } }], text: "" },
        { toolCalls: [], text: "You have Standup tomorrow." },
      ]),
      calendar: { listEvents, getEvent: async () => ({}) },
    });

    const out = await runOrchestrator({ text: "calendar tomorrow?", channel: "web" }, deps);

    expect(listEvents).toHaveBeenCalledWith({ day: "tomorrow" });
    expect(out).toBe("You have Standup tomorrow.");
    expect(audits[0]!.status).toBe("ok");
    expect(audits[0]!.tool_calls).toEqual([
      { name: "list_events", args: { day: "tomorrow" }, result: events },
    ]);
  });

  it("runs a github tool call when a github client is provided, and records it", async () => {
    const issues = [{ number: 7, title: "bug" }];
    const listIssues = vi.fn(async () => issues);
    const { audits, deps } = harness({
      model: scriptedModel([
        { toolCalls: [{ id: "g1", name: "list_issues", args: { state: "open" } }], text: "" },
        { toolCalls: [], text: "You have 1 open issue." },
      ]),
      github: { listIssues, getIssue: async () => ({}), getFile: async () => ({}) },
    });

    const out = await runOrchestrator({ text: "any open issues?", channel: "web" }, deps);

    expect(listIssues).toHaveBeenCalledWith({ state: "open" });
    expect(out).toBe("You have 1 open issue.");
    expect(audits[0]!.status).toBe("ok");
    expect(audits[0]!.tool_calls).toEqual([
      { name: "list_issues", args: { state: "open" }, result: issues },
    ]);
  });

  it("refuses github tools when no github client is wired (deny-by-default)", async () => {
    const { audits, deps } = harness({
      model: scriptedModel([
        { toolCalls: [{ id: "g1", name: "list_issues", args: {} }], text: "" },
      ]),
    });

    const out = await runOrchestrator({ text: "issues?", channel: "web" }, deps);

    expect(audits[0]!.status).toBe("error");
    expect(audits[0]!.error).toMatch(/permit|unknown|tool/i);
    expect(out).toMatch(/sorry|couldn't|error/i);
  });

  it("runs a gmail tool call when a gmail client is provided, and records it", async () => {
    const messages = [{ id: "m1", snippet: "hi" }];
    const listMessages = vi.fn(async () => messages);
    const { audits, deps } = harness({
      model: scriptedModel([
        { toolCalls: [{ id: "e1", name: "list_messages", args: { q: "is:unread" } }], text: "" },
        { toolCalls: [], text: "You have 1 unread message." },
      ]),
      gmail: { listMessages, getMessage: async () => ({}) },
    });

    const out = await runOrchestrator({ text: "any unread email?", channel: "web" }, deps);

    expect(listMessages).toHaveBeenCalledWith({ q: "is:unread" });
    expect(out).toBe("You have 1 unread message.");
    expect(audits[0]!.status).toBe("ok");
    expect(audits[0]!.tool_calls).toEqual([
      { name: "list_messages", args: { q: "is:unread" }, result: messages },
    ]);
  });

  it("refuses gmail tools when no gmail client is wired (deny-by-default)", async () => {
    const { audits, deps } = harness({
      model: scriptedModel([
        { toolCalls: [{ id: "e1", name: "list_messages", args: {} }], text: "" },
      ]),
    });

    const out = await runOrchestrator({ text: "email?", channel: "web" }, deps);

    expect(audits[0]!.status).toBe("error");
    expect(audits[0]!.error).toMatch(/permit|unknown|tool/i);
    expect(out).toMatch(/sorry|couldn't|error/i);
  });

  it("runs a notion tool call when a notion client is provided, and records it", async () => {
    const results = [{ id: "p1", object: "page" }];
    const search = vi.fn(async () => ({ results }));
    const { audits, deps } = harness({
      model: scriptedModel([
        { toolCalls: [{ id: "n1", name: "notion_search", args: { query: "roadmap" } }], text: "" },
        { toolCalls: [], text: "Found 1 page." },
      ]),
      notion: { search, getPage: async () => ({}), getBlockChildren: async () => ({}) },
    });

    const out = await runOrchestrator({ text: "find roadmap in notion", channel: "web" }, deps);

    expect(search).toHaveBeenCalledWith({ query: "roadmap" });
    expect(out).toBe("Found 1 page.");
    expect(audits[0]!.status).toBe("ok");
    expect(audits[0]!.tool_calls).toEqual([
      { name: "notion_search", args: { query: "roadmap" }, result: { results } },
    ]);
  });

  it("refuses notion tools when no notion client is wired (deny-by-default)", async () => {
    const { audits, deps } = harness({
      model: scriptedModel([
        { toolCalls: [{ id: "n1", name: "notion_search", args: {} }], text: "" },
      ]),
    });

    const out = await runOrchestrator({ text: "notion?", channel: "web" }, deps);

    expect(audits[0]!.status).toBe("error");
    expect(audits[0]!.error).toMatch(/permit|unknown|tool/i);
    expect(out).toMatch(/sorry|couldn't|error/i);
  });

  it("runs a memory_search tool call when a memory store is provided, and records it", async () => {
    const hits = [{ content: "we chose recall-as-a-tool", metadata: {}, similarity: 0.91 }];
    const recall = vi.fn(async () => hits);
    const { audits, deps } = harness({
      model: scriptedModel([
        { toolCalls: [{ id: "s1", name: "memory_search", args: { query: "rag decision", k: 5 } }], text: "" },
        { toolCalls: [], text: "We chose recall-as-a-tool." },
      ]),
      memory: { recall, remember: async () => {} },
    });

    const out = await runOrchestrator({ text: "what did we decide about rag?", channel: "web" }, deps);

    expect(recall).toHaveBeenCalledWith("rag decision", 5);
    expect(out).toBe("We chose recall-as-a-tool.");
    expect(audits[0]!.status).toBe("ok");
    expect(audits[0]!.tool_calls).toEqual([
      { name: "memory_search", args: { query: "rag decision", k: 5 }, result: hits },
    ]);
  });

  it("refuses memory_search when no memory store is wired (deny-by-default)", async () => {
    const { audits, deps } = harness({
      model: scriptedModel([
        { toolCalls: [{ id: "s1", name: "memory_search", args: { query: "anything" } }], text: "" },
      ]),
    });

    const out = await runOrchestrator({ text: "recall something", channel: "web" }, deps);

    expect(audits[0]!.status).toBe("error");
    expect(audits[0]!.error).toMatch(/permit|unknown|tool/i);
    expect(out).toMatch(/sorry|couldn't|error/i);
  });

  it("catches a tool failure, logs status=error, and returns a graceful message", async () => {
    const { audits, deps } = harness({
      model: scriptedModel([
        { toolCalls: [{ id: "t1", name: "list_events", args: {} }], text: "" },
        { toolCalls: [], text: "unreachable" },
      ]),
      calendar: {
        listEvents: async () => {
          throw new Error("calendar down");
        },
        getEvent: async () => ({}),
      },
    });

    const out = await runOrchestrator({ text: "calendar?", channel: "web" }, deps);

    expect(out).toMatch(/sorry|couldn't|error/i);
    expect(audits[0]!.status).toBe("error");
    expect(audits[0]!.error).toContain("calendar down");
    expect(audits[0]!.tool_calls![0]).toMatchObject({
      name: "list_events",
      error: expect.stringContaining("calendar down"),
    });
  });

  it("refuses an unknown/unpermitted tool without calling the calendar", async () => {
    const listEvents = vi.fn(async () => []);
    const { audits, deps } = harness({
      model: scriptedModel([
        { toolCalls: [{ id: "t1", name: "delete_everything", args: {} }], text: "" },
      ]),
      calendar: { listEvents, getEvent: async () => ({}) },
    });

    const out = await runOrchestrator({ text: "do bad thing", channel: "web" }, deps);

    expect(listEvents).not.toHaveBeenCalled();
    expect(audits[0]!.status).toBe("error");
    expect(audits[0]!.error).toMatch(/unknown|unpermitted|tool/i);
    expect(out).toMatch(/sorry|couldn't|error/i);
  });

  it("refuses a known tool denied by an injected gate, without calling the calendar", async () => {
    const listEvents = vi.fn(async () => []);
    const { audits, deps } = harness({
      model: scriptedModel([
        { toolCalls: [{ id: "t1", name: "list_events", args: {} }], text: "" },
      ]),
      calendar: { listEvents, getEvent: async () => ({}) },
      // Policy tighter than the default: allows nothing.
      gate: allowlistGate([]),
    });

    const out = await runOrchestrator({ text: "list my events", channel: "web" }, deps);

    expect(listEvents).not.toHaveBeenCalled();
    expect(audits[0]!.status).toBe("error");
    expect(audits[0]!.error).toMatch(/permit/i);
    expect(audits[0]!.tool_calls![0]).toMatchObject({ name: "list_events" });
    expect(out).toMatch(/sorry|couldn't|error/i);
  });

  it("catches a model failure, logs status=error, and returns a graceful message", async () => {
    const { audits, deps } = harness({
      model: {
        turn: async () => {
          throw new Error("model gateway timeout");
        },
      },
    });

    const out = await runOrchestrator({ text: "hi", channel: "web" }, deps);

    expect(out).toMatch(/sorry|couldn't|error/i);
    expect(audits[0]!.status).toBe("error");
    expect(audits[0]!.error).toContain("model gateway timeout");
  });

  it("stops at the max-hop limit instead of looping forever", async () => {
    const listEvents = vi.fn(async () => []);
    const alwaysTool: ModelClient = {
      turn: async () => ({ toolCalls: [{ id: "t", name: "list_events", args: {} }], text: "" }),
    };
    const { audits, deps } = harness({
      model: alwaysTool,
      calendar: { listEvents, getEvent: async () => ({}) },
      maxHops: 3,
    });

    const out = await runOrchestrator({ text: "loop", channel: "web" }, deps);

    expect(listEvents).toHaveBeenCalledTimes(3);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.status).toBe("error");
    expect(audits[0]!.error).toMatch(/hop/i);
    expect(out).toMatch(/sorry|couldn't|error/i);
  });
});
