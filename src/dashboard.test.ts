import { describe, it, expect } from "vitest";
import { dashboardPage } from "./dashboard.js";

describe("dashboardPage", () => {
  const html = dashboardPage();

  it("returns an HTML document", () => {
    expect(html.toLowerCase()).toContain("<!doctype html");
    expect(html).toMatch(/<html/i);
  });

  it("sends the typed message to POST /message", () => {
    // The page must reference the worker's message endpoint and POST to it.
    expect(html).toContain("/message");
    expect(html).toMatch(/method:\s*["']POST["']/i);
  });

  it("reads the audit feed from GET /audit", () => {
    expect(html).toContain("/audit");
  });

  it("loads the approval queue from /approvals", () => {
    expect(html).toContain("/approvals");
  });

  it("posts approve and deny decisions to /approvals/:id", () => {
    expect(html).toContain('"/approvals/"'); // decision endpoint prefix
    expect(html).toContain('"approved"');
    expect(html).toContain('"denied"');
  });

  it("surfaces the executed and failed outcome states", () => {
    expect(html).toContain("executed");
    expect(html).toContain("failed");
  });

  // ponytail: browser Web Speech APIs (SpeechRecognition/speechSynthesis) can't
  // run in vitest (no DOM/browser globals) — these are string-presence checks
  // on the emitted HTML/script, matching the rest of this suite's approach.
  describe("voice (Task B1)", () => {
    it("has a mic button in the send form", () => {
      expect(html).toMatch(/id=["']mic["']/);
    });

    it("wires up the Web Speech API for speech-to-text", () => {
      expect(html).toContain("SpeechRecognition");
      expect(html).toContain("webkitSpeechRecognition");
    });

    it("wires up speechSynthesis for text-to-speech", () => {
      expect(html).toContain("speechSynthesis");
      expect(html).toContain("SpeechSynthesisUtterance");
    });

    it("hides the mic button when speech recognition is unsupported", () => {
      expect(html).toMatch(/mic\.hidden\s*=\s*true/);
    });

    it("only speaks replies to voice-initiated queries", () => {
      // Snapshot of the voice flag, taken up front so a concurrent typed submit
      // can't inherit read-aloud; the speak call is gated by that snapshot.
      expect(html).toMatch(/const speakReply = voiceQuery/);
      expect(html).toMatch(/speakReply\s*&&\s*window\.speechSynthesis/);
    });
  });
});
