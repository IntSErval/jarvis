import { describe, it, expect, vi } from "vitest";
import {
  runOrchestrator,
  type CalendarClient,
  type ModelClient,
  type ModelTurn,
  type OrchestratorDeps,
} from "./orchestrator.js";
import type { AuditInput } from "./db/audit.js";

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
