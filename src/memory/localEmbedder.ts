// Deterministic $0 fallback Embedder — the memory-store analogue of
// stubModel/stubCalendar. Lets the memory store run end-to-end with no
// network and no API key.
//
// ponytail: deterministic hash embedding — no semantic meaning; swap for a
// real embedding provider (OpenAI/Voyage/etc.) adapter for meaningful recall.

import type { Embedder } from "./store.js";

/** FNV-1a style rolling hash, seeded per output dimension. */
function hashChar(seed: number, code: number): number {
  let h = seed ^ code;
  h = Math.imul(h, 16777619);
  return h >>> 0;
}

export function localEmbedder(dim = 1536): Embedder {
  return {
    embed: async (text: string) => {
      const vec = new Array<number>(dim).fill(0);
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        const bucket = (i + code) % dim;
        vec[bucket] = hashChar(vec[bucket] ?? 0, code);
      }
      // Map raw hash counts into [-1, 1] range, then L2-normalize.
      const scaled = vec.map((h) => (h % 2000) / 1000 - 1);
      const norm = Math.sqrt(scaled.reduce((sum, x) => sum + x * x, 0)) || 1;
      return scaled.map((x) => x / norm);
    },
  };
}
