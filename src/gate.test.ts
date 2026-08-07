import { describe, it, expect } from "vitest";
import { allowlistGate } from "./gate.js";

describe("allowlistGate", () => {
  const gate = allowlistGate(["list_events", "get_event"]);

  it("allows a tool on the allowlist", () => {
    expect(gate.check({ name: "list_events", args: {} })).toEqual({ allow: true });
  });

  it("denies a tool not on the allowlist, with a reason naming the tool", () => {
    const decision = gate.check({ name: "delete_everything", args: {} });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toMatch(/delete_everything/);
    expect(decision.reason).toMatch(/permit/i);
  });

  it("denies every tool when the allowlist is empty (deny-by-default)", () => {
    const empty = allowlistGate([]);
    expect(empty.check({ name: "list_events", args: {} }).allow).toBe(false);
  });
});
