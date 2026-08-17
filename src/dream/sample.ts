// Pure seed selection for dreaming (PRD 5.4): pick the memories most worth
// dreaming about. Weighted toward low neighborhood density (isolated ideas the
// model hasn't already connected) and age (decaying items resurface). No I/O —
// the dreamer feeds these seeds to the model.

import type { ScannedMemory } from "../memory/store.js";

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Select up to n seed memories, highest score first.
 *  score = sparsity (1 - mean cosine to the rest) + normalized age. */
export function sampleSeeds(memories: ScannedMemory[], n: number, now: Date = new Date()): ScannedMemory[] {
  if (n <= 0 || memories.length === 0) return [];

  const ages = memories.map((m) => now.getTime() - new Date(m.created_at).getTime());
  const maxAge = Math.max(...ages, 0);

  const scored = memories.map((m, i) => {
    // Neighborhood density: mean cosine similarity to every other memory.
    let sim = 0;
    for (let j = 0; j < memories.length; j++) {
      if (j !== i) sim += cosine(m.embedding, memories[j]!.embedding);
    }
    const density = memories.length > 1 ? sim / (memories.length - 1) : 0;
    const sparsity = 1 - density;
    // ponytail: equal-weighted sparsity + age, age normalized to the batch's
    // oldest. Add tunable weights if one signal ends up dominating in practice.
    const ageWeight = maxAge > 0 ? ages[i]! / maxAge : 0;
    return { memory: m, score: sparsity + ageWeight };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map((s) => s.memory);
}
