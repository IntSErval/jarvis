import { describe, it, expect, vi } from "vitest";
import { pgvectorMemory } from "./pgvector.js";
import type { Embedder } from "./store.js";

const URL = "https://proj.supabase.co";
const KEY = "service-key-123";

const fakeEmbedder: Embedder = { embed: async () => [0.1, 0.2, 0.3] };

function okFetch(body: unknown = "") {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status: 200 }),
  );
}

describe("pgvectorMemory.remember", () => {
  it("embeds the content and POSTs to /rest/v1/memories with auth headers and Prefer: return=minimal", async () => {
    const fetchFn = okFetch();
    const store = pgvectorMemory({ url: URL, serviceKey: KEY, embed: fakeEmbedder, fetchFn });

    await store.remember({ content: "hello world", metadata: { source: "test" } });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(`${URL}/rest/v1/memories`);
    expect(init!.method).toBe("POST");
    const headers = init!.headers as Record<string, string>;
    expect(headers.apikey).toBe(KEY);
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Prefer).toBe("return=minimal");
    const body = JSON.parse(init!.body as string);
    expect(body.content).toBe("hello world");
    expect(body.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(body.metadata).toEqual({ source: "test" });
  });

  it("defaults metadata to {} when omitted", async () => {
    const fetchFn = okFetch();
    const store = pgvectorMemory({ url: URL, serviceKey: KEY, embed: fakeEmbedder, fetchFn });

    await store.remember({ content: "no metadata here" });

    const [, init] = fetchFn.mock.calls[0]!;
    const body = JSON.parse(init!.body as string);
    expect(body.metadata).toEqual({});
  });

  it("throws an error containing 'memory' when Supabase returns non-2xx", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 401 }));
    const store = pgvectorMemory({ url: URL, serviceKey: KEY, embed: fakeEmbedder, fetchFn });

    await expect(store.remember({ content: "x" })).rejects.toThrow(/memory/i);
  });
});

describe("pgvectorMemory.recall", () => {
  it("embeds the query and POSTs to /rest/v1/rpc/match_memories, returning the rows", async () => {
    const rows = [{ content: "hello world", metadata: { source: "test" }, similarity: 0.9 }];
    const fetchFn = okFetch(rows);
    const store = pgvectorMemory({ url: URL, serviceKey: KEY, embed: fakeEmbedder, fetchFn });

    const out = await store.recall("hello?", 3);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(`${URL}/rest/v1/rpc/match_memories`);
    expect(init!.method).toBe("POST");
    const headers = init!.headers as Record<string, string>;
    expect(headers.apikey).toBe(KEY);
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(init!.body as string);
    expect(body.query_embedding).toEqual([0.1, 0.2, 0.3]);
    expect(body.match_count).toBe(3);
    expect(out).toEqual(rows);
  });

  it("uses defaultK when k is not given", async () => {
    const fetchFn = okFetch([]);
    const store = pgvectorMemory({ url: URL, serviceKey: KEY, embed: fakeEmbedder, fetchFn, defaultK: 5 });

    await store.recall("hello?");

    const [, init] = fetchFn.mock.calls[0]!;
    const body = JSON.parse(init!.body as string);
    expect(body.match_count).toBe(5);
  });

  it("defaults to 8 when neither k nor defaultK is given", async () => {
    const fetchFn = okFetch([]);
    const store = pgvectorMemory({ url: URL, serviceKey: KEY, embed: fakeEmbedder, fetchFn });

    await store.recall("hello?");

    const [, init] = fetchFn.mock.calls[0]!;
    const body = JSON.parse(init!.body as string);
    expect(body.match_count).toBe(8);
  });

  it("throws an error containing 'memory' when Supabase returns non-2xx", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 500 }));
    const store = pgvectorMemory({ url: URL, serviceKey: KEY, embed: fakeEmbedder, fetchFn });

    await expect(store.recall("hello?")).rejects.toThrow(/memory/i);
  });
});

describe("pgvectorMemory.scan", () => {
  const rows = [
    { content: "a", embedding: [0.1, 0.2], metadata: { channel: "web" }, created_at: "2026-08-17T00:00:00Z" },
  ];

  it("GETs recent memories with embeddings, newest first, and returns the rows", async () => {
    const fetchFn = okFetch(rows);
    const store = pgvectorMemory({ url: URL, serviceKey: KEY, embed: fakeEmbedder, fetchFn });

    const out = await store.scan(50);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe(
      `${URL}/rest/v1/memories?select=content,embedding,metadata,created_at&order=created_at.desc&limit=50`,
    );
    // GET (no explicit method, or "GET") — never a write.
    expect(init?.method ?? "GET").toBe("GET");
    const headers = init!.headers as Record<string, string>;
    expect(headers.apikey).toBe(KEY);
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(out).toEqual(rows);
  });

  it("defaults to a bounded limit of 200 when none is given", async () => {
    const fetchFn = okFetch([]);
    const store = pgvectorMemory({ url: URL, serviceKey: KEY, embed: fakeEmbedder, fetchFn });

    await store.scan();

    const [url] = fetchFn.mock.calls[0]!;
    expect(String(url)).toContain("limit=200");
  });

  it("does not embed anything (scan is not a query)", async () => {
    const embed = vi.fn(async () => [0.1]);
    const fetchFn = okFetch([]);
    const store = pgvectorMemory({ url: URL, serviceKey: KEY, embed: { embed }, fetchFn });

    await store.scan();

    expect(embed).not.toHaveBeenCalled();
  });

  it("throws an error containing 'memory' when Supabase returns non-2xx", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 500 }));
    const store = pgvectorMemory({ url: URL, serviceKey: KEY, embed: fakeEmbedder, fetchFn });

    await expect(store.scan()).rejects.toThrow(/memory/i);
  });
});
