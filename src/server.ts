// Walking skeleton HTTP glue. Node built-in http, no framework.
//   POST /message  { "text": "...", "channel": "web" }  -> orchestrator reply
//   GET  /audit?limit=20                                -> recent audit rows
//
// Model + calendar are stubs so this runs at $0 with no credentials. Swap the
// stubs for the real Anthropic ModelClient and Google CalendarClient (same
// ports) once you have keys — nothing else here changes.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { runOrchestrator, type CalendarClient, type ModelClient } from "./orchestrator.js";
import type { AuditStore } from "./db/audit.js";
import { makeAuditLogger } from "./db/audit.js";
import { fileAuditStore } from "./store/fileAudit.js";
import { supabaseAuditStore } from "./store/supabaseAudit.js";
import { anthropicModel } from "./model/anthropic.js";
import { googleCalendar } from "./calendar/google.js";
import { githubClient, type GithubClient } from "./github/github.js";
import { gmailClient, type GmailClient } from "./mail/gmail.js";
import { notionClient, type NotionClient } from "./notion/notion.js";
import { pgvectorMemory } from "./memory/pgvector.js";
import { localEmbedder } from "./memory/localEmbedder.js";
import { googleEmbedder } from "./memory/googleEmbedder.js";
import type { Embedder, MemoryStore } from "./memory/store.js";
import { dashboardPage } from "./dashboard.js";
import { loadRoutines } from "./routines/routines.js";
import { runDueRoutines } from "./routines/scheduler.js";

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

// Read-only Notion: active only when an integration token is present. Absent
// => the orchestrator omits Notion tools entirely (deny-by-default).
const { NOTION_TOKEN } = process.env;
const notion: NotionClient | undefined = NOTION_TOKEN ? notionClient({ token: NOTION_TOKEN }) : undefined;

// Semantic memory: active when Supabase creds exist. Real Google embeddings when
// GOOGLE_AI_API_KEY is set, else the free deterministic localEmbedder (lexical
// only). Absent Supabase creds => the orchestrator omits the memory_search tool
// (deny-by-default), $0 with no creds.
// ponytail: recall/remember 500 until db/memory.sql (memories table +
// match_memories() RPC) is run in the Supabase SQL editor — infra, not code.
const embedder: Embedder = process.env.GOOGLE_AI_API_KEY
  ? googleEmbedder({ apiKey: process.env.GOOGLE_AI_API_KEY })
  : localEmbedder();
const memory: MemoryStore | undefined =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? pgvectorMemory({
        url: process.env.SUPABASE_URL,
        serviceKey: process.env.SUPABASE_SERVICE_KEY,
        embed: embedder,
      })
    : undefined;

// Single deps object shared by the POST /message handler and the routine
// scheduler, so wiring a new capability never needs updating in two places.
const orchestratorDeps = {
  model,
  calendar,
  logAudit,
  ...(github ? { github } : {}),
  ...(gmail ? { gmail } : {}),
  ...(notion ? { notion } : {}),
  ...(memory ? { memory } : {}),
};

// Cron-triggered routines: opt-in via ROUTINES_FILE. Absent => no scheduler at
// all (deny-by-default, $0 with no creds).
// ponytail: one in-process 60s tick, no job queue — fine for a single user.
if (process.env.ROUTINES_FILE) {
  // ponytail: routines loaded once at boot — editing routines.json needs a
  // restart to take effect. Re-read per tick if hot-reload ever matters.
  // ponytail: a malformed routines.json throws here and aborts startup — that's
  // intentional fail-fast; better a loud boot failure than a silently dead scheduler.
  const routines = await loadRoutines(process.env.ROUTINES_FILE);
  const timer = setInterval(() => {
    void runDueRoutines(routines, new Date(), (prompt, channel) =>
      runOrchestrator({ text: prompt, channel }, orchestratorDeps),
    );
  }, 60_000);
  timer.unref();
}

console.log(
  `jarvis: model=${process.env.ANTHROPIC_API_KEY ? "anthropic" : "stub"} ` +
    `store=${process.env.SUPABASE_URL ? "supabase" : "file"} ` +
    `calendar=${GOOGLE_OAUTH_REFRESH_TOKEN ? "google" : "stub"} ` +
    `github=${GITHUB_TOKEN ? "on" : "off"} ` +
    `gmail=${gmail ? "on" : "off"} ` +
    `notion=${notion ? "on" : "off"} ` +
    `memory=${memory ? "on" : "off"} ` +
    `embed=${process.env.GOOGLE_AI_API_KEY ? "google" : "local"} ` +
    `routines=${process.env.ROUTINES_FILE ? "on" : "off"}`,
);

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// The Command Deck dashboard (imported Claude Design) ships as two static files
// in public/. Serving them from a fixed allowlist avoids any path-traversal
// surface. Paths resolve relative to this source file, not cwd.
// ponytail: front-end shell — dreams/graph/skills/routines/approvals/health are
// simulated in-page (those backends are Phase 3-5). Wire the audit ledger to
// GET /audit when the real feed is worth showing.
const STATIC_FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/support.js": { file: "support.js", type: "text/javascript; charset=utf-8" },
};

async function serveStatic(res: ServerResponse, entry: { file: string; type: string }): Promise<void> {
  const body = await readFile(new URL(`../public/${entry.file}`, import.meta.url));
  res.writeHead(200, { "Content-Type": entry.type });
  res.end(body);
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

    if (req.method === "GET" && url.pathname in STATIC_FILES) {
      return serveStatic(res, STATIC_FILES[url.pathname]!);
    }

    // The original Phase-1 message + audit-feed page — the only functional UI.
    if (req.method === "GET" && url.pathname === "/console") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(dashboardPage());
    }

    if (req.method === "POST" && url.pathname === "/message") {
      const { text, channel = "web" } = JSON.parse((await readBody(req)) || "{}");
      if (typeof text !== "string" || text.length === 0) {
        return send(res, 400, { error: "body must include a non-empty 'text' string" });
      }
      const reply = await runOrchestrator({ text, channel }, orchestratorDeps);
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
