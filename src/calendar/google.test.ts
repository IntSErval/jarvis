import { describe, it, expect, vi } from "vitest";
import { googleCalendar } from "./google.js";

const CONFIG = {
  clientId: "cid",
  clientSecret: "csecret",
  refreshToken: "rtoken",
};

// Route mock fetch by URL: token endpoint -> access token, calendar API -> body.
function router(opts: {
  token?: { status?: number; body?: unknown };
  calendar?: { status?: number; body?: unknown };
} = {}) {
  const token = opts.token ?? { status: 200, body: { access_token: "at-1", expires_in: 3600 } };
  const cal = opts.calendar ?? { status: 200, body: { items: [] } };
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const u = String(url);
    const pick = u.includes("oauth2.googleapis.com/token") ? token : cal;
    return new Response(JSON.stringify(pick.body), { status: pick.status ?? 200 });
  });
}

describe("googleCalendar", () => {
  it("refreshes the access token, then GETs events with a Bearer token (read-only)", async () => {
    const fetchFn = router({ calendar: { body: { items: [{ id: "e1" }] } } });
    const out = await googleCalendar({ ...CONFIG, fetchFn }).listEvents({ timeMin: "2026-08-08T00:00:00Z" });

    // 1st call: token refresh
    const [tokenUrl, tokenInit] = fetchFn.mock.calls[0]!;
    expect(String(tokenUrl)).toBe("https://oauth2.googleapis.com/token");
    expect(tokenInit!.method).toBe("POST");
    const form = new URLSearchParams(tokenInit!.body as string);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("client_id")).toBe("cid");
    expect(form.get("client_secret")).toBe("csecret");
    expect(form.get("refresh_token")).toBe("rtoken");

    // 2nd call: calendar events list — GET, primary calendar, arg passed through as query
    const [calUrl, calInit] = fetchFn.mock.calls[1]!;
    expect(calInit!.method ?? "GET").toBe("GET");
    expect(String(calUrl)).toContain("/calendar/v3/calendars/primary/events");
    expect(String(calUrl)).toContain("timeMin=2026-08-08T00%3A00%3A00Z");
    expect((calInit!.headers as Record<string, string>).Authorization).toBe("Bearer at-1");

    expect(out).toEqual({ items: [{ id: "e1" }] });
  });

  it("getEvent GETs a single event by id", async () => {
    const fetchFn = router({ calendar: { body: { id: "evt123" } } });
    const out = await googleCalendar({ ...CONFIG, fetchFn }).getEvent({ eventId: "evt123" });

    const [calUrl, calInit] = fetchFn.mock.calls[1]!;
    expect(calInit!.method ?? "GET").toBe("GET");
    expect(String(calUrl)).toContain("/calendar/v3/calendars/primary/events/evt123");
    expect(out).toEqual({ id: "evt123" });
  });

  it("honours a custom calendarId (url-encoded)", async () => {
    const fetchFn = router();
    await googleCalendar({ ...CONFIG, calendarId: "me@example.com", fetchFn }).listEvents({});
    expect(String(fetchFn.mock.calls[1]![0])).toContain("/calendars/me%40example.com/events");
  });

  it("caches the access token across calls (one refresh for two reads)", async () => {
    const fetchFn = router();
    const cal = googleCalendar({ ...CONFIG, fetchFn });
    await cal.listEvents({});
    await cal.listEvents({});
    const tokenCalls = fetchFn.mock.calls.filter((c) => String(c[0]).includes("oauth2.googleapis.com/token"));
    expect(tokenCalls).toHaveLength(1);
  });

  it("re-refreshes once the cached token has expired", async () => {
    const fetchFn = router({ token: { body: { access_token: "at-1", expires_in: 3600 } } });
    let t = 0;
    const cal = googleCalendar({ ...CONFIG, fetchFn, now: () => t });
    await cal.listEvents({});
    t = 3600_000 + 1; // jump past expiry
    await cal.listEvents({});
    const tokenCalls = fetchFn.mock.calls.filter((c) => String(c[0]).includes("oauth2.googleapis.com/token"));
    expect(tokenCalls).toHaveLength(2);
  });

  it("throws eventId is required when getEvent is called without one", async () => {
    const fetchFn = router();
    await expect(googleCalendar({ ...CONFIG, fetchFn }).getEvent({})).rejects.toThrow(/eventId/i);
  });

  it("throws when the token refresh fails", async () => {
    const fetchFn = router({ token: { status: 400, body: { error: "invalid_grant" } } });
    await expect(googleCalendar({ ...CONFIG, fetchFn }).listEvents({})).rejects.toThrow(/token|400/i);
  });

  it("throws when the calendar API returns a non-2xx status", async () => {
    const fetchFn = router({ calendar: { status: 403, body: { error: "forbidden" } } });
    await expect(googleCalendar({ ...CONFIG, fetchFn }).listEvents({})).rejects.toThrow(/calendar|403/i);
  });
});
