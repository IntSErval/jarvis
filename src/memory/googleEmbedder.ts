// Real Embedder backed by Google's Generative Language API (AI Studio) — free
// tier, plain fetch, no @google/generative-ai SDK. Same $0-fallback contract as
// the other adapters: server.ts uses this only when GOOGLE_AI_API_KEY is set,
// otherwise the deterministic localEmbedder stands in.
//
// Defaults to gemini-embedding-001 at 1536 dims (Matryoshka truncation) so the
// vectors drop straight into the vector(1536) column in db/memory.sql with no
// schema change. The store uses cosine distance (<=>), which is scale-invariant,
// so truncated (unnormalized) vectors are fine as-is.

import type { Embedder } from "./store.js";

type FetchFn = typeof fetch;

interface Config {
  apiKey: string;
  /** Embedding model. Default gemini-embedding-001 (supports 768/1536/3072). */
  model?: string;
  /** Output dimension; must match the pgvector column (db/memory.sql = 1536). */
  dimensions?: number;
  fetchFn?: FetchFn;
}

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export function googleEmbedder(config: Config): Embedder {
  const { apiKey, model = "gemini-embedding-001", dimensions = 1536, fetchFn = fetch } = config;

  return {
    embed: async (text: string): Promise<number[]> => {
      const res = await fetchFn(`${API_BASE}/${model}:embedContent?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          outputDimensionality: dimensions,
        }),
      });
      if (!res.ok) throw new Error(`google embed failed: ${res.status} ${await res.text()}`);
      const body = (await res.json()) as { embedding?: { values?: number[] } };
      const values = body.embedding?.values;
      if (!values) throw new Error("google embed: no embedding values in response");
      return values;
    },
  };
}
