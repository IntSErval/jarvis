# TDD Evidence — Read-only GitHub Adapter (Phase 2 start)

**Date:** 2026-08-08
**Branch:** foundation-phase-1
**Scope:** First increment of Phase 2 ("Core loop") — a read-only GitHub
integration behind a new port, wired into the orchestrator env-gated.

## 1. Source plan

No `*.plan.md` was supplied for this increment. Journeys were derived during
this TDD run from the PRD build order (§7: after Calendar, add Gmail/Notion/
GitHub, each **read-only first** per §5.2) and the user's explicit choice of
GitHub for the first Phase 2 adapter.

## 2. User journeys

- As the user, I want Jarvis to **list issues** in one of my GitHub repos
  (read-only), so I can ask about open work.
- As the user, I want Jarvis to **fetch a single issue** by number.
- As the user, I want Jarvis to **read a file's contents** from a repo.
- As the operator, I want the PAT sent as a `Bearer` credential with GitHub's
  required headers (incl. `User-Agent`), and **no write methods** to exist
  (least privilege, PRD 5.2).
- As the operator, I want GitHub tools reachable **only when a token is
  configured** — deny-by-default otherwise, preserving the $0/no-creds run.

## 3. Task report

### Task A — GitHub REST adapter (`src/github/github.ts`)

One-sentence summary: a `GithubClient` port + `fetch`-based read-only adapter
(list issues / get issue / get file), mirroring the calendar adapter.

- **RED** — `npx vitest run src/github/github.test.ts`
  → `Error: Cannot find module './github.js'` (8 specs could not load).
  Committed as `8f65423 test: add reproducer for read-only GitHub adapter`.
- **GREEN** — after implementing the adapter, first run was 5/8: the three
  "throws on missing arg" specs failed because the methods threw
  *synchronously* (`.rejects` never saw a promise). Making the three methods
  `async` fixed it → **8/8 pass**, typecheck clean.
  Committed as `4163c13 feat: read-only GitHub REST adapter (GithubClient port)`.
- **Guarantee:** the adapter GETs the correct GitHub REST v3 URLs with the
  right auth headers, resolves owner/repo (arg overrides config default),
  validates required args, and throws on non-2xx — with no write surface.

### Task B — wire GitHub into the orchestrator loop (`src/orchestrator.ts`, `src/server.ts`)

One-sentence summary: GitHub is added as an **optional, additive** capability;
tool dispatch generalized to a name→handler registry so future integrations
plug in without loop surgery.

- **RED** — `npx vitest run src/orchestrator.test.ts`
  → new "runs a github tool call…" spec failed: `listIssues` was never called
  because the loop didn't route `list_issues` (8 passed / 1 failed).
  Committed as `2f6f761 test: add reproducer for GitHub tools in the orchestrator loop`.
- **GREEN** — after adding `GITHUB_TOOLS`, `buildDispatch`, and exposing the
  wired tools + defaulting the gate to the wired tool names → **full suite
  45/45 pass**, typecheck clean. server.ts activates GitHub only when
  `GITHUB_TOKEN` is set.
  Committed as `109e9e4 feat: wire read-only GitHub tools into the orchestrator loop, env-gated`.
- **Guarantee:** with a github client injected, the loop dispatches GitHub
  tools and records them; with none injected, GitHub tools are denied by
  default and the Phase 1 calendar behavior is unchanged.

## 4. Test specification

| # | What is guaranteed | Test file / name | Type | Result | Evidence |
|---|--------------------|------------------|------|--------|----------|
| 1 | listIssues GETs repo issues with Bearer PAT + required GitHub headers (incl. User-Agent), args as query | `github.test.ts:listIssues GETs the repo issues…` | unit | PASS | `npx vitest run src/github/github.test.ts` |
| 2 | getIssue GETs a single issue by number | `github.test.ts:getIssue GETs a single issue by number` | unit | PASS | same |
| 3 | getFile GETs contents, encoding each path segment but keeping slashes | `github.test.ts:getFile GETs repo file contents…` | unit | PASS | same |
| 4 | owner/repo from args overrides the config defaults | `github.test.ts:honours owner/repo from args…` | unit | PASS | same |
| 5 | missing owner/repo (no default) throws | `github.test.ts:throws when owner/repo is missing…` | unit | PASS | same |
| 6 | getIssue without number throws | `github.test.ts:throws when getIssue is called without a number` | unit | PASS | same |
| 7 | getFile without path throws | `github.test.ts:throws when getFile is called without a path` | unit | PASS | same |
| 8 | non-2xx GitHub response throws | `github.test.ts:throws when the GitHub API returns a non-2xx status` | unit | PASS | same |
| 9 | loop dispatches a github tool and records it when a client is wired | `orchestrator.test.ts:runs a github tool call…` | integration | PASS | `npx vitest run src/orchestrator.test.ts` |
| 10 | github tools denied by default when no client is wired | `orchestrator.test.ts:refuses github tools when no github client is wired` | integration | PASS | same |

## 5. Coverage and known gaps

`npx vitest run --coverage`:

- `src/github/github.ts` — 100% stmts / 100% funcs / 100% lines / 86.36% branch
  (uncovered branches: non-scalar arg skipped in `toQuery`; an `encodePath`
  edge — both benign).
- `src/orchestrator.ts` — 100% stmts / 100% funcs / 100% lines / 84% branch.
- All files: 98.57% stmts — well above the 80% target.

Intentional gaps / follow-ups:
- No live end-to-end probe against `api.github.com` in this run (all fetch is
  mocked). Live verification deferred until a PAT is in `.env`.
- `toQuery` is duplicated in `google.ts` and `github.ts` with differing
  signatures; not extracted (over-abstraction for two ~10-line helpers).

## 6. Merge evidence

RED→GREEN→(no separate refactor needed) checkpoint commits on
`foundation-phase-1`:

```
8f65423 test: add reproducer for read-only GitHub adapter          (RED, adapter)
4163c13 feat: read-only GitHub REST adapter (GithubClient port)     (GREEN, adapter)
2f6f761 test: add reproducer for GitHub tools in the orchestrator   (RED, wiring)
109e9e4 feat: wire read-only GitHub tools into the orchestrator …   (GREEN, wiring)
```
