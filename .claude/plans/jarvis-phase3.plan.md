# Plan: Jarvis — Routines & Messaging (Phase 3)

**Source PRD**: `prd.md` §5.1 (Routines), §5.6 (Messaging Gateway), Build Order #3
**Branch**: `phase3-routines-messaging`
**Complexity**: Medium

## Summary
Two capabilities, each an adapter behind the existing ports-&-adapters pattern,
env-gated with a $0-no-creds fallback — exactly like calendar/gmail/github/notion:

1. **Cron-triggered routines** — declarative `{ schedule, prompt, channel }`
   playbooks that fire on a cron expression, run the orchestrator, and get
   audited (channel-tagged). Output optionally delivered to a messaging channel.
2. **WhatsApp gateway** — inbound webhook (verify-token + HMAC-signed) → parse
   message → run orchestrator (channel `whatsapp`) → reply back via the
   WhatsApp Cloud API. Outbound `sendText` is a plain-`fetch` adapter mirroring
   `github.ts`.

## Scope (ponytail — what Phase 3 is NOT)
- No routine *builder UI* (PRD §6) — routines are a JSON config file for now.
- No multi-platform gateway — WhatsApp only (prove the adapter pattern, PRD §3).
- No human-approval gate for routine actions — routines stay **read-only** (they
  run the existing read-only tool surface), so nothing irreversible happens. The
  approval gate lands with write actions (Phase 4+).
- No full cron syntax — a minimal 5-field matcher (`*`, `N`, `*/n`, `a,b`) that
  covers "every morning at 8" (`0 8 * * *`). `// ponytail:` the ceiling.
- No job queue / distributed scheduler — one `setInterval(60s)` tick in-process.

## Patterns to Mirror
| Concern | Mirror | Why |
|---|---|---|
| `fetch` adapter, read-only, typed errors | `src/github/github.ts` | WhatsApp `sendText` + inbound parse |
| Env-gated wiring + stub fallback | `src/server.ts` (gmail/notion/github blocks) | both features wire the same way |
| Pure logic + injected `now`/deps, co-located test | `src/db/audit.ts`, `src/gate.ts` | cron matcher + scheduler |
| Deny-by-default when creds absent | orchestrator `deps.x ? TOOLS : []` | routes/tools omitted with no creds |
| TDD, co-located `*.test.ts` | every existing module | red → green per task |

## Tasks

### Task 1: Cron-triggered routines
- **Files**:
  - `src/routines/cron.ts` + `cron.test.ts` — pure `cronMatches(expr: string, at: Date): boolean`. Support the 5 standard fields (min hour dom month dow), each field one of: `*`, an integer, `*/n` step, or comma list `a,b,c`. Throw on malformed expressions. This is the non-trivial logic — test it hard (matches at the minute, non-matches, `*/15`, comma lists, field bounds).
  - `src/routines/routines.ts` — `Routine` type `{ id: string; schedule: string; prompt: string; channel?: string }` and `loadRoutines(path: string): Promise<Routine[]>` (reads a JSON array; missing file → `[]`, mirroring `fileAudit`'s ENOENT handling).
  - `src/routines/scheduler.ts` + `scheduler.test.ts` — pure `dueRoutines(routines, at): Routine[]` (filters by `cronMatches`), and `runDueRoutines(routines, at, run, deliver?)` where `run(prompt, channel) => Promise<string>` is injected (the orchestrator in prod) and optional `deliver(routine, reply) => Promise<void>`. Each due routine: call `run(prompt, channel ?? "routine:"+id)`, then `deliver` if given. Errors in one routine must not stop the others (catch per-routine).
- **Wire (server.ts)**: if `ROUTINES_FILE` env is set, `loadRoutines` it at startup and `setInterval(60_000)` → `runDueRoutines(routines, new Date(), (prompt, channel) => runOrchestrator({text: prompt, channel}, deps))`. Absent env → no scheduler (deny-by-default, $0). Add `routines=on/off` to the startup console line. `unref()` the interval so it never blocks process exit.
- **Mirror**: `github.ts` error style; `fileAudit.ts` ENOENT; `audit.ts` injected-`now`.
- **Validate**: unit tests green (cron matcher + scheduler). Manually: a `routines.json` with `{"schedule":"* * * * *","prompt":"say hi","channel":"routine:test"}` + `ROUTINES_FILE` set → within a minute an audit row appears with channel `routine:test`.

### Task 2: WhatsApp messaging gateway
- **Files**:
  - `src/messaging/whatsapp.ts` + `whatsapp.test.ts`:
    - `whatsappClient({ token, phoneNumberId, fetchFn? })` → `{ sendText(to: string, body: string): Promise<unknown> }`. POST `https://graph.facebook.com/v21.0/{phoneNumberId}/messages` with Bearer token, JSON body `{ messaging_product: "whatsapp", to, type: "text", text: { body } }`. Throw on non-ok, mirroring `github.ts` `get()`.
    - Pure `parseInboundMessage(webhookBody: unknown): { from: string; text: string } | null` — dig `entry[].changes[].value.messages[]`, return the first text message's `{ from, text: text.body }`, else `null` (status callbacks, non-text → null).
    - Pure `verifyWebhook(query: {mode?, token?, challenge?}, verifyToken): string | null` — return `challenge` iff `mode === "subscribe"` and `token === verifyToken`, else `null`.
    - `verifySignature(rawBody: string, signatureHeader: string | undefined, appSecret: string): boolean` — HMAC-SHA256 of the raw body with `appSecret`, constant-time compare against the `sha256=` header (Node `crypto`, stdlib). **Trust boundary — required, not optional.**
- **Wire (server.ts)**: env-gate on `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_VERIFY_TOKEN` + `WHATSAPP_APP_SECRET`. When present:
  - `GET /webhook/whatsapp` → `verifyWebhook(query, VERIFY_TOKEN)`; 200 + challenge text, else 403.
  - `POST /webhook/whatsapp` → read **raw** body; `verifySignature` (403 on fail); `parseInboundMessage`; if a message, `runOrchestrator({text, channel:"whatsapp"}, deps)` then `whatsapp.sendText(from, reply)`; always 200 to WhatsApp (ack) so it doesn't retry. Absent creds → routes 404 (deny-by-default, $0). Add `whatsapp=on/off` to the startup line.
  - **Routine delivery hookup**: if both routines and whatsapp are wired and a routine's `channel` is `whatsapp`, pass a `deliver` that `sendText`s to `WHATSAPP_SELF` (env, the user's own number). Optional — keep Task 1 independent of this.
- **Mirror**: `github.ts` for the fetch adapter; `server.ts` gmail/notion blocks for env gating.
- **Validate**: unit tests green (send, parse, verifyWebhook, verifySignature happy + tampered). Manually (needs Meta creds): webhook verify GET echoes challenge; a WhatsApp message to the number gets an orchestrator reply back.

## Validation
```bash
npm run typecheck
npm test
# Task 1 manual:
ROUTINES_FILE=routines.json npm run dev   # every-minute routine → audit row
# Task 2 manual (with Meta creds in .env): message the WhatsApp number, get a reply
```

## Security
- WhatsApp inbound is a **trust boundary**: verify-token on GET, HMAC-SHA256
  signature on POST (constant-time compare). Do not merge Task 2 without both.
- Everything stays **read-only** (routines run the existing read-only tools),
  so no approval gate needed yet. Any future write tool re-opens that question.
- New env vars are placeholders only in `.env.example` (real secrets live in
  gitignored `.env`).

## Acceptance
- [ ] Both tasks complete, `npm test` + `npm run typecheck` green
- [ ] Routines fire on schedule and are audited; scheduler survives one routine erroring
- [ ] WhatsApp: verify-token + signature both enforced; inbound → orchestrator → reply
- [ ] `$0` with no creds preserved (no env → no scheduler, webhook 404s)
- [ ] `.env.example` updated with placeholder WhatsApp + ROUTINES_FILE vars
