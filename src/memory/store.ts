// Memory ports — Jarvis's own semantic memory substrate (PRD 5.3). Interfaces
// only; adapters (pgvector.ts, localEmbedder.ts) implement these. Wired into the
// orchestrator loop: exchanges are auto-remembered and recalled memories are
// proactively injected before each model turn (see orchestrator.ts).

/** Embeds text into a fixed-length vector. Injected so the store is provider-agnostic. */
export interface Embedder {
  embed(text: string): Promise<number[]>;
}

export interface MemoryRecord {
  content: string;
  metadata?: Record<string, unknown>;
}

/** Jarvis's own semantic memory substrate (PRD 5.3). */
export interface MemoryStore {
  /** Embed and persist a memory. */
  remember(record: MemoryRecord): Promise<void>;
  /** Embed the query and return the top-k most similar memories (RAG-style, PRD 5.3 / 8 — never a full dump). */
  recall(query: string, k?: number): Promise<Array<{ content: string; metadata: Record<string, unknown>; similarity: number }>>;
}
