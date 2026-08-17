import { describe, it, expect } from "vitest";
import { buildDreamEntry } from "./dream.js";

const fixedNow = () => new Date("2026-08-17T03:00:00Z");
const fixedId = () => "dream-1";

describe("buildDreamEntry", () => {
  it("normalizes a raw proposal into a complete 'new' entry", () => {
    const entry = buildDreamEntry(
      {
        idea: "Batch the Tuesday standup notes into one weekly digest.",
        sourceNotes: ["User: standup ran long", "Jarvis: noted 3 recurring items"],
        confidence: 0.7,
        category: "idea",
      },
      fixedNow,
      fixedId,
    );

    expect(entry).toEqual({
      id: "dream-1",
      ts: "2026-08-17T03:00:00.000Z",
      idea: "Batch the Tuesday standup notes into one weekly digest.",
      sourceNotes: ["User: standup ran long", "Jarvis: noted 3 recurring items"],
      confidence: 0.7,
      category: "idea",
      status: "new",
      decided_at: null,
    });
  });

  it("clamps confidence into [0,1]", () => {
    expect(buildDreamEntry({ idea: "x", sourceNotes: [], confidence: 1.8, category: "question" }, fixedNow, fixedId).confidence).toBe(1);
    expect(buildDreamEntry({ idea: "x", sourceNotes: [], confidence: -0.3, category: "question" }, fixedNow, fixedId).confidence).toBe(0);
  });

  it("preserves each dream category", () => {
    for (const category of ["idea", "reminder", "contradiction", "question"] as const) {
      expect(buildDreamEntry({ idea: "x", sourceNotes: [], confidence: 0.5, category }, fixedNow, fixedId).category).toBe(category);
    }
  });
});
