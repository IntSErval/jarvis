import { describe, expect, it } from "vitest";
import { cronMatches } from "./cron.js";

describe("cronMatches", () => {
  it("matches an exact minute/hour", () => {
    expect(cronMatches("30 8 * * *", new Date(2026, 0, 5, 8, 30))).toBe(true);
  });

  it("does not match a different minute", () => {
    expect(cronMatches("30 8 * * *", new Date(2026, 0, 5, 8, 31))).toBe(false);
  });

  it("does not match a different hour", () => {
    expect(cronMatches("30 8 * * *", new Date(2026, 0, 5, 9, 30))).toBe(false);
  });

  it("step */15 matches :00 :15 :30 :45", () => {
    for (const m of [0, 15, 30, 45]) {
      expect(cronMatches("*/15 * * * *", new Date(2026, 0, 5, 10, m))).toBe(true);
    }
  });

  it("step */15 does not match :07", () => {
    expect(cronMatches("*/15 * * * *", new Date(2026, 0, 5, 10, 7))).toBe(false);
  });

  it("comma list matches any listed value", () => {
    expect(cronMatches("0,30 * * * *", new Date(2026, 0, 5, 10, 0))).toBe(true);
    expect(cronMatches("0,30 * * * *", new Date(2026, 0, 5, 10, 30))).toBe(true);
    expect(cronMatches("0,30 * * * *", new Date(2026, 0, 5, 10, 15))).toBe(false);
  });

  it("matches day-of-week", () => {
    // Jan 5 2026 is a Monday (day-of-week 1)
    const monday = new Date(2026, 0, 5, 9, 0);
    expect(monday.getDay()).toBe(1);
    expect(cronMatches("0 9 * * 1", monday)).toBe(true);
    expect(cronMatches("0 9 * * 2", monday)).toBe(false);
  });

  it("throws on wrong field count", () => {
    expect(() => cronMatches("* * *", new Date())).toThrow("cron: invalid expression: * * *");
  });

  it("throws on malformed token", () => {
    expect(() => cronMatches("bad * * * *", new Date())).toThrow(
      "cron: invalid expression: bad * * * *",
    );
  });

  it("throws on out-of-range field values", () => {
    for (const expr of ["99 * * * *", "0 25 * * *", "0 0 32 * *", "0 0 * 13 *", "0 0 * * 8"]) {
      expect(() => cronMatches(expr, new Date())).toThrow("cron: invalid expression");
    }
  });
});
