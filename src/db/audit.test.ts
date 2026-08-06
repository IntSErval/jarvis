import { describe, it, expect } from "vitest";
import { buildAuditRow, makeAuditLogger, type AuditRow, type AuditStore } from "./audit.js";

describe("buildAuditRow", () => {
  it("stamps an ISO-8601 timestamp and applies defaults", () => {
    const fixed = new Date("2026-08-06T09:30:00.000Z");
    const row = buildAuditRow(
      { channel: "web", user_msg: "hi", response: "hello" },
      () => fixed,
    );

    expect(row.ts).toBe("2026-08-06T09:30:00.000Z");
    expect(row.tool_calls).toEqual([]);
    expect(row.status).toBe("ok");
    expect(row.error).toBeNull();
    expect(row).toMatchObject({ channel: "web", user_msg: "hi", response: "hello" });
  });

  it("preserves provided tool_calls, error status, and error text", () => {
    const row = buildAuditRow({
      channel: "web",
      user_msg: "what's on my calendar?",
      response: "Sorry, I couldn't reach your calendar.",
      status: "error",
      error: "calendar down",
      tool_calls: [{ name: "list_events", args: {}, error: "calendar down" }],
    });

    expect(row.status).toBe("error");
    expect(row.error).toBe("calendar down");
    expect(row.tool_calls).toHaveLength(1);
    expect(row.tool_calls[0]).toMatchObject({ name: "list_events" });
  });

  it("makeAuditLogger inserts a normalized row into the store", async () => {
    const inserted: AuditRow[] = [];
    const store: AuditStore = {
      insert: async (row) => {
        inserted.push(row);
      },
      recent: async () => [],
    };
    const fixed = new Date("2026-08-06T09:30:00.000Z");
    const logAudit = makeAuditLogger(store, () => fixed);

    await logAudit({ channel: "web", user_msg: "hi", response: "hello" });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ ts: "2026-08-06T09:30:00.000Z", status: "ok", channel: "web" });
  });
});
