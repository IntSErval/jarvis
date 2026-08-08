// Deterministic $0 fallback Embedder — the memory-store analogue of
// stubModel/stubCalendar. Lets the memory store run end-to-end with no
// network and no API key.
//
// ponytail: deterministic hash embedding — captures lexical overlap only, no
// semantic meaning; adequate as a $0 wiring stub, swap for a real embedding
// provider (OpenAI/Voyage/etc.) for meaningful recall.

import type { Embedder } from "./store.js";

/** Deterministic signed hash of a char code + position → roughly [-1, 1]. */
function signedHash(code: number, i: number): number {
  let h = Math.imul(code ^ 0x811c9dc5, 16777619) ^ Math.imul(i + 1, 2654435761);
  h >>>= 0;
  return (h % 2000) / 1000 - 1; // signed contribution, mean ~0
}

export function localEmbedder(dim = 1536): Embedder {
  return {
    embed: async (text: string) => {
      // Untouched buckets stay 0 (neutral); touched buckets accumulate signed
      // signal, so distinct short strings get sparse, separable vectors.
      const vec = new Array<number>(dim).fill(0);
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        const bucket = (i + code) % dim;
        vec[bucket] = (vec[bucket] ?? 0) + signedHash(code, i);
      }
      const norm = Math.sqrt(vec.reduce((sum, x) => sum + x * x, 0)) || 1;
      return vec.map((x) => x / norm);
    },
  };
}
