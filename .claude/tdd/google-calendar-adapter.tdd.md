# TDD Evidence — Read-only Google Calendar adapter

**Date:** 2026-08-08 · **Branch:** `foundation-phase-1`
**Checkpoints:** `cd6f807` (RED) → `13a172b` (GREEN)

## Source plan
No `*.plan.md`. Journey derived this run: it is the last unbuilt port of Phase 1
— every other `CalendarClient`-shaped dependency had a real adapter; the calendar
was still `stubCalendar`.

## User journey
> As the Jarvis owner, I want the assistant to answer over my real Google
> Calendar (read-only), so the audited calendar loop works against live data
> instead of an empty stub — while $0 local dev (no creds → stub) still holds.

## Task report
- **What:** Added `src/calendar/google.ts` — a `CalendarClient` over Google
  Calendar API v3. Refresh-token → cached short-lived access token → read-only
  `GET` of events. Wired into `src/server.ts`, env-gated on the `GOOGLE_OAUTH_*`
  vars; absent creds keep `stubCalendar`.
- **RED:** `npx vitest run src/calendar/google.test.ts` → *Cannot find module
  './google.js'* (reproducer compiled and failed for the intended reason: no
  implementation). Committed at `cd6f807`.
- **GREEN:** after implementation, same command → **8 passed**. Full suite
  `npm test` → **35 passed**. `npm run typecheck` → clean. Committed at `13a172b`.
- **Guaranteed:** read-only access (only GETs the calendar; the sole POST is the
  OAuth token exchange), correct auth flow, token caching, and graceful failure
  on both token-refresh and calendar errors.

## Test specification
| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Refreshes token, then GETs events with `Bearer` on the primary calendar; arg passed through as query | `google.test.ts:refreshes the access token…` | unit | PASS |
| 2 | `getEvent` GETs a single event by id | `google.test.ts:getEvent GETs a single event by id` | unit | PASS |
| 3 | Custom `calendarId` is URL-encoded into the path | `google.test.ts:honours a custom calendarId` | unit | PASS |
| 4 | Access token is cached — two reads, one refresh | `google.test.ts:caches the access token…` | unit | PASS |
| 5 | Expired cached token triggers exactly one re-refresh | `google.test.ts:re-refreshes once the cached token has expired` | unit | PASS |
| 6 | `getEvent` without `eventId` rejects | `google.test.ts:throws eventId is required…` | unit | PASS |
| 7 | Token-refresh non-2xx throws | `google.test.ts:throws when the token refresh fails` | unit | PASS |
| 8 | Calendar API non-2xx throws | `google.test.ts:throws when the calendar API returns a non-2xx status` | unit | PASS |

## Coverage & known gaps
`vitest run --coverage src/calendar/google.test.ts` → `google.ts`: **100% stmts,
100% funcs, 100% lines, 78% branch**. Uncovered branches (lines 31, 63-64, 77)
are defensive `??`/type-guard fallbacks. No live integration test — blocked on a
valid `calendar.readonly` refresh token (`.env.example`'s slot still holds the
token *endpoint URL*, not a token).
