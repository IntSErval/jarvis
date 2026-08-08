// Walking skeleton HTTP glue. Node built-in http, no framework.
//   POST /message  { "text": "...", "channel": "web" }  -> orchestrator reply
//   GET  /audit?limit=20                                -> recent audit rows
//
// Model + calendar are stubs so this runs at $0 with no credentials. Swap the
// stubs for the real Anthropic ModelClient and Google CalendarClient (same
// ports) once you have keys — nothing else here changes.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { runOrchestrator, type CalendarClient, type ModelClient } from "./orchestrator.js";
import type { AuditStore } from "./db/audit.js";
import { makeAuditLogger } from "./db/audit.js";
import { fileAuditStore } from "./store/fileAudit.js";
import { supabaseAuditStore } from "./store/supabaseAudit.js";
import { anthropicModel } from "./model/anthropic.js";
import { googleCalendar } from "./calendar/google.js";
import { githubClient, type GithubClient } from "./github/github.js";
import { gmailClient, type GmailClient } from "./mail/gmail.js";
import { dashboardPage } from "./dashboard.js";

const PORT = Number(process.env.PORT ?? 3000);
const AUDIT_FILE = process.env.AUDIT_FILE ?? "audit.json";

// ponytail: canned model fallback — proves the loop with no API key. Used only
// when ANTHROPIC_API_KEY is absent.
const stubModel: ModelClient = {
  turn: async (messages) => ({
    toolCalls: [],
    text: `(stub) I received: "${messages[messages.length - 1]?.content ?? ""}"`,
  }),
};

// ponytail: empty read-only calendar until the real Google client is wired
// (blocked on a valid GOOGLE_OAUTH_REFRESH_TOKEN).
const stubCalendar: CalendarClient = {
  listEvents: async () => [],
  getEvent: async () => ({}),
};

// Real adapters when creds exist, free local fallbacks otherwise — same ports.
const model: ModelClient = process.env.ANTHROPIC_API_KEY
  ? anthropicModel(process.env.ANTHROPIC_API_KEY, process.env.MODEL ? { model: process.env.MODEL } : {})
  : stubModel;

const store: AuditStore =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? supabaseAuditStore(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : fileAuditStore(AUDIT_FILE);

const logAudit = makeAuditLogger(store);

const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN } = process.env;
const calendar: CalendarClient =
  GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET && GOOGLE_OAUTH_REFRESH_TOKEN
    ? googleCalendar({
        clientId: GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: GOOGLE_OAUTH_CLIENT_SECRET,
        refreshToken: GOOGLE_OAUTH_REFRESH_TOKEN,
        ...(process.env.GOOGLE_CALENDAR_ID ? { calendarId: process.env.GOOGLE_CALENDAR_ID } : {}),
      })
    : stubCalendar;

// Read-only GitHub: active only when a token is present. Absent => the
// orchestrator omits GitHub tools entirely (deny-by-default), $0 with no creds.
const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;
const github: GithubClient | undefined = GITHUB_TOKEN
  ? githubClient({
      token: GITHUB_TOKEN,
      ...(GITHUB_OWNER ? { owner: GITHUB_OWNER } : {}),
      ...(GITHUB_REPO ? { repo: GITHUB_REPO } : {}),
    })
  : undefined;

// Read-only Gmail: reuses the Google OAuth creds but needs the gmail.readonly
// scope on the refresh token, so it's opt-in via GMAIL_ENABLED to avoid
// surprising 403s when the existing calendar-scoped token lacks Gmail access.
// Absent => the orchestrator omits Gmail tools entirely (deny-by-default).
const gmail: GmailClient | undefined =
  GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET && GOOGLE_OAUTH_REFRESH_TOKEN && process.env.GMAIL_ENABLED
    ? gmailClient({
        clientId: GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: GOOGLE_OAUTH_CLIENT_SECRET,
        refreshToken: GOOGLE_OAUTH_REFRESH_TOKEN,
      })
    : undefined;

console.log(
  `jarvis: model=${process.env.ANTHROPIC_API_KEY ? "anthropic" : "stub"} ` +
    `store=${process.env.SUPABASE_URL ? "supabase" : "file"} ` +
    `calendar=${GOOGLE_OAUTH_REFRESH_TOKEN ? "google" : "stub"} ` +
    `github=${GITHUB_TOKEN ? "on" : "off"} ` +
    `gmail=${gmail ? "on" : "off"}`,
);

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(dashboardPage());
    }

    if (req.method === "POST" && url.pathname === "/message") {
      const { text, channel = "web" } = JSON.parse((await readBody(req)) || "{}");
      if (typeof text !== "string" || text.length === 0) {
        return send(res, 400, { error: "body must include a non-empty 'text' string" });
      }
      const reply = await runOrchestrator(
        { text, channel },
        { model, calendar, logAudit, ...(github ? { github } : {}), ...(gmail ? { gmail } : {}) },
      );
      return send(res, 200, { reply });
    }

    if (req.method === "GET" && url.pathname === "/audit") {
      const limit = Number(url.searchParams.get("limit") ?? 20);
      return send(res, 200, { rows: await store.recent(Number.isFinite(limit) ? limit : 20) });
    }

    return send(res, 404, { error: "not found" });
  } catch (err) {
    send(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, () => console.log(`jarvis skeleton listening on http://localhost:${PORT}`));
