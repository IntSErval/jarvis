import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileApprovalStore } from "./fileApprovals.js";
import { buildApproval, type Approval } from "../db/approvals.js";

function approval(overrides: Partial<Approval> = {}): Approval {
  return {
    ...buildApproval(
      { channel: "web", tool: "notion_create_page", args: { title: "hi" } },
      () => new Date("2026-08-14T00:00:00.000Z"),
      () => "id-fixed",
    ),
    ...overrides,
  };
}

describe("fileApprovalStore", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jarvis-approvals-"));
    path = join(dir, "approvals.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns an empty list when the file does not exist yet", async () => {
    expect(await fileApprovalStore(path).recent(10)).toEqual([]);
  });

  it("persists an inserted approval and returns it newest-first", async () => {
    const store = fileApprovalStore(path);
    await store.insert(approval({ id: "a" }));
    await store.insert(approval({ id: "b" }));

    const recent = await store.recent(10);
    expect(recent.map((r) => r.id)).toEqual(["b", "a"]);
    expect(recent[0]).toMatchObject({ status: "pending", decided_at: null });
  });

  it("setStatus flips a pending approval and stamps decided_at", async () => {
    const store = fileApprovalStore(path);
    await store.insert(approval({ id: "a" }));

    const updated = await store.setStatus("a", "approved", { now: () => new Date("2026-08-14T01:00:00.000Z") });
    expect(updated).toMatchObject({ id: "a", status: "approved", decided_at: "2026-08-14T01:00:00.000Z" });

    const [reloaded] = await fileApprovalStore(path).recent(10);
    expect(reloaded).toMatchObject({ status: "approved" });
  });

  it("setStatus persists the execute result on 'executed' and the reason on 'failed'", async () => {
    const store = fileApprovalStore(path);
    await store.insert(approval({ id: "ok" }));
    await store.insert(approval({ id: "bad" }));

    await store.setStatus("ok", "executed", { result: { pageId: "p1" } });
    await store.setStatus("bad", "failed", { error: "notion 400" });

    const rows = await fileApprovalStore(path).recent(10);
    expect(rows.find((r) => r.id === "ok")).toMatchObject({ status: "executed", result: { pageId: "p1" } });
    expect(rows.find((r) => r.id === "bad")).toMatchObject({ status: "failed", error: "notion 400" });
  });

  it("setStatus returns undefined for an unknown id and writes nothing", async () => {
    const store = fileApprovalStore(path);
    await store.insert(approval({ id: "a" }));

    expect(await store.setStatus("nope", "denied")).toBeUndefined();
    expect((await store.recent(10))[0]).toMatchObject({ id: "a", status: "pending" });
  });
});
