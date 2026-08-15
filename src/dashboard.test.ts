import { describe, it, expect } from "vitest";
import { dashboardPage } from "./dashboard.js";

describe("dashboardPage", () => {
  const html = dashboardPage();

  it("returns an HTML document", () => {
    expect(html.toLowerCase()).toContain("<!doctype html");
    expect(html).toMatch(/<html/i);
  });

  it("sends the typed message to POST /message", () => {
    // The page must reference the worker's message endpoint and POST to it.
    expect(html).toContain("/message");
    expect(html).toMatch(/method:\s*["']POST["']/i);
  });

  it("reads the audit feed from GET /audit", () => {
    expect(html).toContain("/audit");
  });

  it("loads the approval queue from /approvals", () => {
    expect(html).toContain("/approvals");
  });

  it("posts approve and deny decisions to /approvals/:id", () => {
    expect(html).toContain('"/approvals/"'); // decision endpoint prefix
    expect(html).toContain('"approved"');
    expect(html).toContain('"denied"');
  });

  it("surfaces the executed and failed outcome states", () => {
    expect(html).toContain("executed");
    expect(html).toContain("failed");
  });
});
