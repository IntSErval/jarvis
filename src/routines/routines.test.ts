import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRoutines, type Routine } from "./routines.js";

let dir: string | undefined;

async function tmpFile(contents: string): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "jarvis-routines-"));
  const path = join(dir, "routines.json");
  await writeFile(path, contents, "utf8");
  return path;
}

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("loadRoutines", () => {
  it("returns [] when the file is missing (ENOENT)", async () => {
    await expect(loadRoutines(join(tmpdir(), "does-not-exist-jarvis-routines.json"))).resolves.toEqual([]);
  });

  it("parses a valid JSON array of routines, including optional channel", async () => {
    const routines: Routine[] = [
      { id: "morning", schedule: "30 8 * * *", prompt: "good morning" },
      { id: "standup", schedule: "0 9 * * 1", prompt: "standup", channel: "slack" },
    ];
    const path = await tmpFile(JSON.stringify(routines));
    expect(await loadRoutines(path)).toEqual(routines);
  });

  it("rejects on malformed JSON", async () => {
    const path = await tmpFile("{ not valid json");
    await expect(loadRoutines(path)).rejects.toThrow();
  });
});
