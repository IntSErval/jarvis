import { describe, it, expect } from "vitest";
import { sampleSeeds } from "./sample.js";
import type { ScannedMemory } from "../memory/store.js";

function mem(embedding: number[], created_at: string, content = "m"): ScannedMemory {
  return { content, embedding, metadata: {}, created_at };
}

const T = "2026-08-17T00:00:00Z"; // common timestamp when age should not matter
const now = new Date("2026-08-20T00:00:00Z");

describe("sampleSeeds", () => {
  it("returns [] for no memories or n<=0", () => {
    expect(sampleSeeds([], 3, now)).toEqual([]);
    expect(sampleSeeds([mem([1, 0], T)], 0, now)).toEqual([]);
  });

  it("returns all memories (deduped set) when n >= count", () => {
    const all = [mem([1, 0], T, "a"), mem([0, 1], T, "b")];
    const out = sampleSeeds(all, 5, now);
    expect(out.map((m) => m.content).sort()).toEqual(["a", "b"]);
  });

  it("prefers a sparse (dissimilar) memory over one in a dense cluster", () => {
    // Two near-identical vectors (dense) + one orthogonal (sparse); equal ages.
    const cluster1 = mem([1, 0], T, "dense-1");
    const cluster2 = mem([1, 0.01], T, "dense-2");
    const outlier = mem([0, 1], T, "sparse");
    const out = sampleSeeds([cluster1, cluster2, outlier], 1, now);
    expect(out.map((m) => m.content)).toEqual(["sparse"]);
  });

  it("prefers older memories when density is equal (decaying items resurface)", () => {
    // Identical embeddings => equal sparsity; age is the tiebreaker.
    const oldest = mem([1, 0], "2026-08-01T00:00:00Z", "old");
    const mid = mem([1, 0], "2026-08-10T00:00:00Z", "mid");
    const newest = mem([1, 0], "2026-08-19T00:00:00Z", "new");
    const out = sampleSeeds([newest, mid, oldest], 1, now);
    expect(out.map((m) => m.content)).toEqual(["old"]);
  });
});
