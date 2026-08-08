import { describe, it, expect, vi } from "vitest";
import { googleEmbedder } from "./googleEmbedder.js";

const KEY = "ai-studio-key-123";

function okFetch(values: number[]) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify({ embedding: { values } }), { status: 200 }),
  );
}

describe("googleEmbedder.embed", () => {
  it("POSTs to the gemini-embedding-001 endpoint with the key and returns the vector", async () => {
    const vec = [0.1, 0.2, 0.3];
    const fetchFn = okFetch(vec);
    const embedder = googleEmbedder({ apiKey: KEY, fetchFn });

    const out = await embedder.embed("hello world");

    expect(out).toEqual(vec);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toContain("gemini-embedding-001:embedContent");
    expect(String(url)).toContain(`key=${KEY}`);
    expect(init!.method).toBe("POST");
    const headers = init!.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init!.body as string);
    expect(body.content.parts[0].text).toBe("hello world");
    // Must match the pgvector column dimension (db/memory.sql, vector(1536)).
    expect(body.outputDimensionality).toBe(1536);
  });

  it("honors a custom model and dimensions", async () => {
    const fetchFn = okFetch([0.5]);
    const embedder = googleEmbedder({ apiKey: KEY, model: "text-embedding-004", dimensions: 768, fetchFn });

    await embedder.embed("x");

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toContain("text-embedding-004:embedContent");
    const body = JSON.parse(init!.body as string);
    expect(body.outputDimensionality).toBe(768);
  });

  it("throws an error containing 'embed' when the API returns non-2xx", async () => {
    const fetchFn = vi.fn(async () => new Response("bad key", { status: 400 }));
    const embedder = googleEmbedder({ apiKey: KEY, fetchFn });

    await expect(embedder.embed("x")).rejects.toThrow(/embed/i);
  });

  it("throws when the response has no embedding values", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ embedding: {} }), { status: 200 }));
    const embedder = googleEmbedder({ apiKey: KEY, fetchFn });

    await expect(embedder.embed("x")).rejects.toThrow(/embed/i);
  });
});
