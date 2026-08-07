import { describe, it, expect, vi } from "vitest";
import { supabaseAuditStore } from "./supabaseAudit.js";
import type { AuditRow } from "../db/audit.js";

const URL = "https://proj.supabase.co";
const KEY = "service-key-123";

const row: AuditRow = {
  ts: "2026-08-07T00:00:00.000Z",
  channel: "web",
  user_msg: "hi",
  tool_calls: [],
  response: "hello",
  status: "ok",
  error: null,
};

function okFetch(body: unknown = "") {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status: 200 }),
  );
}

describe("supabaseAuditStore", () => {
  it("insert POSTs the row to the audit_log table with auth headers", async () => {
    const fetchFn = okFetch();
    await supabaseAuditStore(URL, KEY, fetchFn).insert(row);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(`${URL}/rest/v1/audit_log`);
    expect(init!.method).toBe("POST");
    const headers = init!.headers as Record<string, string>;
    expect(headers.apikey).toBe(KEY);
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init!.body as string)).toMatchObject({ user_msg: "hi", status: "ok" });
  });

  it("insert throws when Supabase returns a non-2xx status", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 401 }));
    await expect(supabaseAuditStore(URL, KEY, fetchFn).insert(row)).rejects.toThrow(/401|supabase/i);
  });

  it("recent GETs rows ordered by ts desc with the limit and returns them", async () => {
    const rows = [row];
    const fetchFn = okFetch(rows);
    const out = await supabaseAuditStore(URL, KEY, fetchFn).recent(5);

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toContain("/rest/v1/audit_log");
    expect(String(url)).toContain("order=ts.desc");
    expect(String(url)).toContain("limit=5");
    expect(init!.method ?? "GET").toBe("GET");
    expect(out).toEqual(rows);
  });
});
