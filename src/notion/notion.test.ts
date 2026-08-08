import { describe, it, expect, vi } from "vitest";
import { notionClient } from "./notion.js";

const CONFIG = { token: "secret_test" };

// Mock fetch: every Notion API call returns the configured body/status.
function router(opts: { status?: number; body?: unknown } = {}) {
  const status = opts.status ?? 200;
  const body = opts.body ?? {};
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    return new Response(JSON.stringify(body), { status });
  });
}

describe("notionClient", () => {
  it("search POSTs to /search with Bearer + Notion-Version headers and args as the JSON body", async () => {
    const fetchFn = router({ body: { results: [{ id: "p1" }] } });
    const out = await notionClient({ ...CONFIG, fetchFn }).search({ query: "roadmap" });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(init!.method).toBe("POST");
    expect(String(url)).toBe("https://api.notion.com/v1/search");
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret_test");
    expect(headers["Notion-Version"]).toBe("2022-06-28");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init!.body as string)).toEqual({ query: "roadmap" });
    expect(out).toEqual({ results: [{ id: "p1" }] });
  });

  it("search defaults to an empty body when called with no args", async () => {
    const fetchFn = router();
    await notionClient({ ...CONFIG, fetchFn }).search(undefined);

    const [, init] = fetchFn.mock.calls[0]!;
    expect(JSON.parse(init!.body as string)).toEqual({});
  });

  it("getPage GETs /pages/{page_id} with the required headers", async () => {
    const fetchFn = router({ body: { id: "p1", object: "page" } });
    const out = await notionClient({ ...CONFIG, fetchFn }).getPage({ page_id: "p1" });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(init!.method ?? "GET").toBe("GET");
    expect(String(url)).toBe("https://api.notion.com/v1/pages/p1");
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret_test");
    expect(headers["Notion-Version"]).toBe("2022-06-28");
    expect(out).toEqual({ id: "p1", object: "page" });
  });

  it("getBlockChildren GETs /blocks/{block_id}/children, with remaining scalar args as query", async () => {
    const fetchFn = router({ body: { results: [] } });
    await notionClient({ ...CONFIG, fetchFn }).getBlockChildren({ block_id: "b1", page_size: 10 });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(init!.method ?? "GET").toBe("GET");
    expect(String(url)).toContain("https://api.notion.com/v1/blocks/b1/children");
    expect(String(url)).toContain("page_size=10");
  });

  it("throws when getPage is called without page_id", async () => {
    const fetchFn = router();
    await expect(notionClient({ ...CONFIG, fetchFn }).getPage({})).rejects.toThrow(/page_id/i);
  });

  it("throws when getBlockChildren is called without block_id", async () => {
    const fetchFn = router();
    await expect(notionClient({ ...CONFIG, fetchFn }).getBlockChildren({})).rejects.toThrow(/block_id/i);
  });

  it("throws when the Notion API returns a non-2xx status", async () => {
    const fetchFn = router({ status: 404, body: { message: "Not Found" } });
    await expect(notionClient({ ...CONFIG, fetchFn }).getPage({ page_id: "p1" })).rejects.toThrow(
      /notion|404/i,
    );
  });
});
