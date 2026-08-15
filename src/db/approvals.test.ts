import { describe, it, expect } from "vitest";
import { buildApproval, executeApproval } from "./approvals.js";

describe("executeApproval", () => {
  it("dispatches the parked tool + args to the matching writer and returns its result", async () => {
    const seen: unknown[] = [];
    const approval = buildApproval({ channel: "web", tool: "notion_create_page", args: { title: "hi" } });

    const result = await executeApproval(approval, {
      notion_create_page: async (args) => {
        seen.push(args);
        return { id: "page-1" };
      },
    });

    expect(seen).toEqual([{ title: "hi" }]);
    expect(result).toEqual({ id: "page-1" });
  });

  it("throws when no writer is registered for the approval's tool", async () => {
    const approval = buildApproval({ channel: "web", tool: "mystery_write", args: {} });
    await expect(executeApproval(approval, {})).rejects.toThrow(/no writer.*mystery_write/);
  });
});
