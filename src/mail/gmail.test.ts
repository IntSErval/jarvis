import { describe, it, expect, vi } from "vitest";
import { gmailClient } from "./gmail.js";

const CONFIG = {
  clientId: "cid",
  clientSecret: "csecret",
  refreshToken: "rtoken",
};

// Route mock fetch by URL: token endpoint -> access token, gmail API -> body.
function router(opts: {
  token?: { status?: number; body?: unknown };
  gmail?: { status?: number; body?: unknown };
} = {}) {
  const token = opts.token ?? { status: 200, body: { access_token: "at-1", expires_in: 3600 } };
  const mail = opts.gmail ?? { status: 200, body: { messages: [] } };
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const u = String(url);
    const pick = u.includes("oauth2.googleapis.com/token") ? token : mail;
    return new Response(JSON.stringify(pick.body), { status: pick.status ?? 200 });
  });
}

describe("gmailClient", () => {
  it("refreshes the access token, then GETs messages with a Bearer token (read-only)", async () => {
    const fetchFn = router({ gmail: { body: { messages: [{ id: "m1" }] } } });
    const out = await gmailClient({ ...CONFIG, fetchFn }).listMessages({ q: "is:unread" });

    // 1st call: token refresh
    const [tokenUrl, tokenInit] = fetchFn.mock.calls[0]!;
    expect(String(tokenUrl)).toBe("https://oauth2.googleapis.com/token");
    expect(tokenInit!.method).toBe("POST");
    const form = new URLSearchParams(tokenInit!.body as string);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("client_id")).toBe("cid");
    expect(form.get("client_secret")).toBe("csecret");
    expect(form.get("refresh_token")).toBe("rtoken");

    // 2nd call: messages list — GET, arg passed through as query
    const [mailUrl, mailInit] = fetchFn.mock.calls[1]!;
    expect(mailInit!.method ?? "GET").toBe("GET");
    expect(String(mailUrl)).toContain("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    expect(String(mailUrl)).toContain("q=is%3Aunread");
    expect((mailInit!.headers as Record<string, string>).Authorization).toBe("Bearer at-1");

    expect(out).toEqual({ messages: [{ id: "m1" }] });
  });

  it("getMessage GETs a single message by id, with remaining args as query", async () => {
    const fetchFn = router({ gmail: { body: { id: "msg123" } } });
    const out = await gmailClient({ ...CONFIG, fetchFn }).getMessage({ id: "msg123", format: "metadata" });

    const [mailUrl, mailInit] = fetchFn.mock.calls[1]!;
    expect(mailInit!.method ?? "GET").toBe("GET");
    expect(String(mailUrl)).toContain("/gmail/v1/users/me/messages/msg123");
    expect(String(mailUrl)).toContain("format=metadata");
    expect(out).toEqual({ id: "msg123" });
  });

  it("caches the access token across calls (one refresh for two reads)", async () => {
    const fetchFn = router();
    const gmail = gmailClient({ ...CONFIG, fetchFn });
    await gmail.listMessages({});
    await gmail.listMessages({});
    const tokenCalls = fetchFn.mock.calls.filter((c) => String(c[0]).includes("oauth2.googleapis.com/token"));
    expect(tokenCalls).toHaveLength(1);
  });

  it("re-refreshes once the cached token has expired", async () => {
    const fetchFn = router({ token: { body: { access_token: "at-1", expires_in: 3600 } } });
    let t = 0;
    const gmail = gmailClient({ ...CONFIG, fetchFn, now: () => t });
    await gmail.listMessages({});
    t = 3600_000 + 1; // jump past expiry
    await gmail.listMessages({});
    const tokenCalls = fetchFn.mock.calls.filter((c) => String(c[0]).includes("oauth2.googleapis.com/token"));
    expect(tokenCalls).toHaveLength(2);
  });

  it("throws when getMessage is called without an id", async () => {
    const fetchFn = router();
    await expect(gmailClient({ ...CONFIG, fetchFn }).getMessage({})).rejects.toThrow(/id/i);
  });

  it("throws when the token refresh fails", async () => {
    const fetchFn = router({ token: { status: 400, body: { error: "invalid_grant" } } });
    await expect(gmailClient({ ...CONFIG, fetchFn }).listMessages({})).rejects.toThrow(/token|400/i);
  });

  it("throws when the gmail API returns a non-2xx status", async () => {
    const fetchFn = router({ gmail: { status: 403, body: { error: "forbidden" } } });
    await expect(gmailClient({ ...CONFIG, fetchFn }).listMessages({})).rejects.toThrow(/gmail|403/i);
  });
});
