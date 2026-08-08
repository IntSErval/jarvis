import { describe, it, expect } from "vitest";
import { localEmbedder } from "./localEmbedder.js";

describe("localEmbedder", () => {
  it("is deterministic: same input produces the identical vector", async () => {
    const embedder = localEmbedder();
    const a = await embedder.embed("hello world");
    const b = await embedder.embed("hello world");
    expect(a).toEqual(b);
  });

  it("produces a vector of the requested length", async () => {
    const embedder = localEmbedder(64);
    const v = await embedder.embed("some text");
    expect(v).toHaveLength(64);
  });

  it("defaults to length 1536", async () => {
    const embedder = localEmbedder();
    const v = await embedder.embed("some text");
    expect(v).toHaveLength(1536);
  });

  it("produces different vectors for different inputs", async () => {
    const embedder = localEmbedder();
    const a = await embedder.embed("hello world");
    const b = await embedder.embed("goodbye world");
    expect(a).not.toEqual(b);
  });

  it("is L2-normalized (norm approximately 1)", async () => {
    const embedder = localEmbedder();
    const v = await embedder.embed("normalize me");
    const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it("keeps distinct short inputs separable (not near-collinear)", async () => {
    const e = localEmbedder();
    const a = await e.embed("hello world");
    const b = await e.embed("goodbye world");
    const cos = a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
    expect(cos).toBeLessThan(0.9);
  });
});
