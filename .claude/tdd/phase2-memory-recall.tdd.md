# TDD Evidence — Phase 2: memory_search recall tool + Google embedder

**Branch:** `phase2-memory-recall`
**Source plan:** none — journeys derived during this TDD run from the two Phase-2
deferred decisions (recall-as-a-tool; free embedding provider). See memory note
`phase2-core-loop-status`.

## User journeys

1. As Jarvis, I want a gated `memory_search` tool so the model can semantically
   recall past memories on demand (RAG-style, top-k — never a full dump), so
   answers can draw on stored context.
2. As the operator, I want memory to stay deny-by-default: absent a wired store,
   the tool is not exposed and any call to it is refused.
3. As the operator, I want real semantic embeddings for free when I supply a
   Google AI Studio key, and a $0 deterministic fallback when I don't — with no
   database schema change either way.

## Task report

### Task 1 — memory_search recall tool
- **Summary:** Added optional `memory?: MemoryStore` port to `OrchestratorDeps`,
  `MEMORY_TOOLS`, and a `memory_search` dispatch handler unpacking `{query,k}`
  into `recall(query, k)`. Wired in `server.ts` (pgvector store on Supabase creds).
- **RED:** `npx vitest run src/orchestrator.test.ts -t "memory_search"` →
  happy-path FAIL (`expected "spy" to be called with [ 'rag decision', 5 ]`,
  0 calls); deny-by-default already PASS. Commit `453a610`.
- **GREEN:** same command → 2 passed. Full suite 79/79, `tsc --noEmit` clean.
  Commit `f322e7a`.
- **Guarantees:** the tool is exposed + permitted only when a store is injected;
  args unpack correctly; results feed back into the loop and are audited; absent
  a store the call is refused (deny-by-default), status=error.

### Task 2 — Google gemini-embedding-001 Embedder
- **Summary:** New `googleEmbedder` adapter behind the `Embedder` port (plain
  fetch to `…/models/<model>:embedContent?key=`, default `gemini-embedding-001`
  at `outputDimensionality: 1536` to match `db/memory.sql`). `server.ts` uses it
  when `GOOGLE_AI_API_KEY` is set, else `localEmbedder`. Cosine store (`<=>`) is
  scale-invariant, so no normalization needed.
- **RED:** `npx vitest run src/memory/googleEmbedder.test.ts` → FAIL, module did
  not exist. Commit `a8387e9`.
- **GREEN:** same command → 4 passed. Full suite 83/83, `tsc --noEmit` clean,
  coverage 99.19% stmts / 83.15% branch. Commit `0b38dd7`.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | `memory_search` calls `recall(query,k)` and records the result | `orchestrator.test.ts:runs a memory_search tool call…` | unit | PASS |
| 2 | Absent a store, `memory_search` is refused (deny-by-default) | `orchestrator.test.ts:refuses memory_search when no memory store…` | unit | PASS |
| 3 | Embedder POSTs to gemini-embedding-001, returns the vector, requests 1536 dims | `googleEmbedder.test.ts:POSTs to the gemini-embedding-001 endpoint…` | unit | PASS |
| 4 | Custom model/dimensions honored | `googleEmbedder.test.ts:honors a custom model and dimensions` | unit | PASS |
| 5 | Non-2xx API response throws | `googleEmbedder.test.ts:throws an error containing 'embed'…` | unit | PASS |
| 6 | Missing embedding values throws | `googleEmbedder.test.ts:throws when the response has no embedding values` | unit | PASS |

## Coverage and known gaps

`npx vitest run --coverage` → All files 99.19% stmts / 83.15% branch (≥80% gate).
`server.ts` remains excluded from coverage (integration glue, per vitest config).

**Known gaps / ceilings (not code bugs):**
- Live `recall`/`remember` return 500 until `db/memory.sql` (the `memories` table
  + `match_memories()` RPC) is run in the Supabase SQL editor — infra step.
- Real Google embeddings require `GOOGLE_AI_API_KEY` in `.env`; unset → lexical
  `localEmbedder`.
- RAG end-to-end (model actually invoking `memory_search` against live Supabase)
  is unit-proven but not yet exercised against the live DB.
