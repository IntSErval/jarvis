// Walking skeleton HTTP glue. Node built-in http, no framework.
//   POST /message  { "text": "...", "channel": "web" }  -> orchestrator reply
//   GET  /audit?limit=20                                -> recent audit rows
//
// Model + calendar are stubs so this runs at $0 with no credentials. Swap the
// stubs for the real Anthropic ModelClient and Google CalendarClient (same
// ports) once you have keys — nothing else here changes.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { runOrchestrator, type CalendarClient, type ModelClient } from "./orchestrator.js";
import { makeAuditLogger } from "./db/audit.js";
import { fileAuditStore } from "./store/fileAudit.js";

const PORT = Number(process.env.PORT ?? 3000);
const AUDIT_FILE = process.env.AUDIT_FILE ?? "audit.json";

// ponytail: canned model — proves the loop end-to-end with no API key. Replace
// with an @anthropic-ai/sdk-backed ModelClient when ANTHROPIC_API_KEY exists.
const stubModel: ModelClient = {
  turn: async (messages) => ({
    toolCalls: [],
    text: `(stub) I received: "${messages[messages.length - 1]?.content ?? ""}"`,
  }),
};

// ponytail: empty read-only calendar until the real Google client is wired.
const stubCalendar: CalendarClient = {
  listEvents: async () => [],
  getEvent: async () => ({}),
};

const store = fileAuditStore(AUDIT_FILE);
const logAudit = makeAuditLogger(store);

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

    if (req.method === "POST" && url.pathname === "/message") {
      const { text, channel = "web" } = JSON.parse((await readBody(req)) || "{}");
      if (typeof text !== "string" || text.length === 0) {
        return send(res, 400, { error: "body must include a non-empty 'text' string" });
      }
      const reply = await runOrchestrator({ text, channel }, { model: stubModel, calendar: stubCalendar, logAudit });
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
