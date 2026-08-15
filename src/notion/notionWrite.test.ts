import { describe, it, expect } from "vitest";
import { notionWriter } from "./notionWrite.js";

function fakeFetch(
  capture: { url?: string; init?: RequestInit },
  res: { ok: boolean; status?: number; body?: unknown },
) {
  return (async (url: string, init: RequestInit) => {
    capture.url = url;
    capture.init = init;
    return {
      ok: res.ok,
      status: res.status ?? (res.ok ? 200 : 500),
      json: async () => res.body ?? {},
      text: async () => "boom",
    } as Response;
  }) as unknown as typeof fetch;
}

describe("notionWriter.createPage", () => {
  it("POSTs the args as the page body to /pages with auth headers", async () => {
    const cap: { url?: string; init?: RequestInit } = {};
    const writer = notionWriter({ token: "sekret", fetchFn: fakeFetch(cap, { ok: true, body: { id: "p1" } }) });

    const args = { parent: { page_id: "abc" }, properties: { title: [{ text: { content: "Hi" } }] } };
    const result = await writer.createPage(args);

    expect(cap.url).toBe("https://api.notion.com/v1/pages");
    expect(cap.init?.method).toBe("POST");
    expect((cap.init?.headers as Record<string, string>).Authorization).toBe("Bearer sekret");
    expect(cap.init?.body).toBe(JSON.stringify(args));
    expect(result).toEqual({ id: "p1" });
  });

  it("throws with the status on a non-ok response", async () => {
    const writer = notionWriter({ token: "t", fetchFn: fakeFetch({}, { ok: false, status: 400 }) });
    await expect(writer.createPage({})).rejects.toThrow(/400/);
  });
});
