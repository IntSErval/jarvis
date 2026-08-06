import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileAuditStore } from "./fileAudit.js";
import type { AuditRow } from "../db/audit.js";

function row(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    ts: "2026-08-06T09:30:00.000Z",
    channel: "web",
    user_msg: "hi",
    tool_calls: [],
    response: "hello",
    status: "ok",
    error: null,
    ...overrides,
  };
}

describe("fileAuditStore", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jarvis-audit-"));
    path = join(dir, "audit.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns an empty list when the file does not exist yet", async () => {
    const store = fileAuditStore(path);
    expect(await store.recent(10)).toEqual([]);
  });

  it("persists an inserted row and returns it", async () => {
    const store = fileAuditStore(path);
    await store.insert(row({ user_msg: "what's on my calendar?" }));

    const recent = await store.recent(10);
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ user_msg: "what's on my calendar?" });
  });

  it("returns rows newest-first and respects the limit", async () => {
    const store = fileAuditStore(path);
    await store.insert(row({ user_msg: "first" }));
    await store.insert(row({ user_msg: "second" }));
    await store.insert(row({ user_msg: "third" }));

    const recent = await store.recent(2);
    expect(recent.map((r) => r.user_msg)).toEqual(["third", "second"]);
  });

  it("survives a reload — a fresh store on the same path sees prior rows", async () => {
    await fileAuditStore(path).insert(row({ user_msg: "durable" }));

    const reopened = fileAuditStore(path);
    const recent = await reopened.recent(10);
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ user_msg: "durable" });
  });
});
