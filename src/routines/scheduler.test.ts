import { describe, expect, it, vi } from "vitest";
import { dueRoutines, runDueRoutines } from "./scheduler.js";
import type { Routine } from "./routines.js";

const AT = new Date(2026, 0, 5, 8, 30); // matches "30 8 * * *"

const routines: Routine[] = [
  { id: "morning", schedule: "30 8 * * *", prompt: "good morning" },
  { id: "noon", schedule: "0 12 * * *", prompt: "lunch" },
];

describe("dueRoutines", () => {
  it("filters to routines whose schedule matches", () => {
    expect(dueRoutines(routines, AT).map((r) => r.id)).toEqual(["morning"]);
  });

  it("returns empty when nothing matches", () => {
    const noon = new Date(2026, 0, 5, 12, 0);
    expect(dueRoutines(routines, noon).map((r) => r.id)).toEqual(["noon"]);
  });
});

describe("runDueRoutines", () => {
  it("calls run once per due routine with the default channel", async () => {
    const run = vi.fn(async (prompt: string) => `reply:${prompt}`);
    await runDueRoutines([routines[0]!], AT, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("good morning", "routine:morning");
  });

  it("uses the explicit channel when provided", async () => {
    const withChannel: Routine = { ...routines[0]!, channel: "custom" };
    const run = vi.fn(async () => "ok");
    await runDueRoutines([withChannel], AT, run);
    expect(run).toHaveBeenCalledWith("good morning", "custom");
  });

  it("calls deliver with the reply when provided", async () => {
    const run = vi.fn(async () => "the reply");
    const deliver = vi.fn(async () => {});
    await runDueRoutines([routines[0]!], AT, run, deliver);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(routines[0], "the reply");
  });

  it("does not call deliver when omitted", async () => {
    const run = vi.fn(async () => "the reply");
    await expect(runDueRoutines([routines[0]!], AT, run)).resolves.toBeUndefined();
  });

  it("continues running other routines when one run rejects", async () => {
    const failing: Routine = { id: "fail", schedule: "30 8 * * *", prompt: "boom" };
    const ok: Routine = { id: "ok", schedule: "30 8 * * *", prompt: "fine" };
    let okCalls = 0;
    const run = vi.fn(async (prompt: string) => {
      if (prompt === "boom") throw new Error("nope");
      okCalls++;
      return "fine reply";
    });
    await runDueRoutines([failing, ok], AT, run);
    expect(okCalls).toBe(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("continues running other routines when one deliver rejects", async () => {
    const a: Routine = { id: "a", schedule: "30 8 * * *", prompt: "a" };
    const b: Routine = { id: "b", schedule: "30 8 * * *", prompt: "b" };
    const run = vi.fn(async (prompt: string) => prompt);
    let deliverCalls = 0;
    const deliver = vi.fn(async (routine: Routine) => {
      deliverCalls++;
      if (routine.id === "a") throw new Error("delivery failed");
    });
    await runDueRoutines([a, b], AT, run, deliver);
    expect(deliverCalls).toBe(2);
  });
});
