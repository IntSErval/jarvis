import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileDreamStore } from "./fileDreams.js";
import { buildDreamEntry } from "../dream/dream.js";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dreams-"));
  path = join(dir, "dreams.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const entry = (id: string) =>
  buildDreamEntry(
    { idea: `idea ${id}`, sourceNotes: [], confidence: 0.5, category: "idea" },
    () => new Date("2026-08-17T03:00:00Z"),
    () => id,
  );

describe("fileDreamStore", () => {
  it("returns [] when the file does not exist yet", async () => {
    const store = fileDreamStore(path);
    expect(await store.recent(10)).toEqual([]);
  });

  it("inserts and returns rows newest-first, honoring the limit", async () => {
    const store = fileDreamStore(path);
    await store.insert(entry("a"));
    await store.insert(entry("b"));
    await store.insert(entry("c"));
    const recent = await store.recent(2);
    expect(recent.map((r) => r.id)).toEqual(["c", "b"]);
  });

  it("persists to disk as JSON", async () => {
    const store = fileDreamStore(path);
    await store.insert(entry("a"));
    const raw = JSON.parse(await readFile(path, "utf8"));
    expect(raw).toHaveLength(1);
    expect(raw[0].id).toBe("a");
  });

  it("setStatus flips status, stamps decided_at, and returns the updated row", async () => {
    const store = fileDreamStore(path);
    await store.insert(entry("a"));
    const updated = await store.setStatus("a", "accepted", () => new Date("2026-08-18T00:00:00Z"));
    expect(updated?.status).toBe("accepted");
    expect(updated?.decided_at).toBe("2026-08-18T00:00:00.000Z");
    // and it's persisted
    const reread = await fileDreamStore(path).recent(1);
    expect(reread[0]!.status).toBe("accepted");
  });

  it("setStatus returns undefined for an unknown id", async () => {
    const store = fileDreamStore(path);
    expect(await store.setStatus("nope", "dismissed")).toBeUndefined();
  });
});
