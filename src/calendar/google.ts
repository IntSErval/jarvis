// Real CalendarClient backed by the Google Calendar API v3, read-only. Same port
// as stubCalendar, so swapping it in is a one-line change in server.ts. Plain
// fetch, no googleapis SDK. Only GETs the calendar — no write methods exist here,
// enforcing least privilege (PRD 5.2) at the adapter, not just the gate.
//
// Auth: a long-lived OAuth refresh token is exchanged for a short-lived access
// token (cached until it expires), which authorizes each read.

import type { CalendarClient } from "../orchestrator.js";

type FetchFn = typeof fetch;

interface Config {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Calendar to read; defaults to the account's primary calendar. */
  calendarId?: string;
  fetchFn?: FetchFn;
  now?: () => number;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/calendar/v3/calendars";

/** Turn a tool-call arg object into a URL query string (skips non-scalars). */
function toQuery(args: unknown): string {
  const params = new URLSearchParams();
  if (args && typeof args === "object") {
    for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        params.set(k, String(v));
      }
    }
  }
  const q = params.toString();
  return q ? `?${q}` : "";
}

export function googleCalendar(config: Config): CalendarClient {
  const { clientId, clientSecret, refreshToken, calendarId = "primary", fetchFn = fetch, now = Date.now } = config;
  const events = `${API_BASE}/${encodeURIComponent(calendarId)}/events`;

  let token = "";
  let expiresAt = 0;

  async function accessToken(): Promise<string> {
    // ponytail: 60s skew buffer; re-refresh on expiry. Fine for one personal
    // user — no refresh-in-flight dedupe (add a shared promise if concurrent).
    if (token && now() < expiresAt - 60_000) return token;
    const res = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }).toString(),
    });
    if (!res.ok) throw new Error(`google token refresh failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    token = body.access_token ?? "";
    expiresAt = now() + (body.expires_in ?? 0) * 1000;
    return token;
  }

  async function get(url: string): Promise<unknown> {
    const res = await fetchFn(url, { method: "GET", headers: { Authorization: `Bearer ${await accessToken()}` } });
    if (!res.ok) throw new Error(`google calendar request failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  return {
    listEvents: (args: unknown) => get(`${events}${toQuery(args)}`),
    getEvent: async (args: unknown) => {
      const { eventId, ...rest } = (args ?? {}) as { eventId?: string; [k: string]: unknown };
      if (!eventId) throw new Error("getEvent: eventId is required");
      return get(`${events}/${encodeURIComponent(eventId)}${toQuery(rest)}`);
    },
  };
}
