// Real GmailClient backed by the Gmail API v1, read-only. Same OAuth refresh
// flow as the calendar adapter: plain fetch, no googleapis SDK. Only GETs the
// mailbox — no send/modify/delete methods exist here, enforcing least
// privilege (PRD 5.2/5.3) at the adapter, not just the gate.
//
// Auth: a long-lived OAuth refresh token is exchanged for a short-lived access
// token (cached until it expires), which authorizes each read. Reuses the
// google.ts refresh+cache pattern verbatim (small duplication, house style —
// see calendar/google.ts).

type FetchFn = typeof fetch;

interface Config {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchFn?: FetchFn;
  now?: () => number;
}

/** Read-only Gmail surface — least privilege (PRD 5.2/5.3). No write methods. */
export interface GmailClient {
  listMessages(args: unknown): Promise<unknown>;
  getMessage(args: unknown): Promise<unknown>;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

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

export function gmailClient(config: Config): GmailClient {
  const { clientId, clientSecret, refreshToken, fetchFn = fetch, now = Date.now } = config;

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
    if (!res.ok) throw new Error(`gmail request failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  return {
    listMessages: (args: unknown) => get(`${API_BASE}/messages${toQuery(args)}`),
    getMessage: async (args: unknown) => {
      const { id, ...rest } = (args ?? {}) as { id?: string; [k: string]: unknown };
      if (!id) throw new Error("getMessage: id is required");
      return get(`${API_BASE}/messages/${encodeURIComponent(id)}${toQuery(rest)}`);
    },
  };
}
