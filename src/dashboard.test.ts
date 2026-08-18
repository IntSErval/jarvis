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

  // ponytail: same ceiling as above — string-presence checks on the emitted
  // script, since Web Speech can't run headless. Covers the hands-free upgrade:
  // always-on listening, an "ADAM" wake word, a feedback guard, and a deep voice.
  describe("hands-free ADAM (voice-only)", () => {
    it("listens continuously instead of one-shot", () => {
      expect(html).toMatch(/recognition\.continuous\s*=\s*true/);
    });

    it("auto-starts listening on load with no button press", () => {
      // The mic is hands-free: recognition starts on load, and the old
      // click-to-talk handler is gone.
      expect(html).toContain("startListening()");
      expect(html).not.toMatch(/mic\.addEventListener/);
    });

    it("keeps listening by restarting when recognition ends", () => {
      // Chrome drops continuous recognition after silence; onend must restart it.
      expect(html).toContain("recognition.onend");
    });

    it("stops retrying when the mic is denied (no tight restart loop)", () => {
      expect(html).toContain("not-allowed");
    });

    it("gates on the ADAM wake word and takes the command after it", () => {
      expect(html).toContain('"adam"');
      expect(html).toContain("indexOf");
    });

    it("stops listening while speaking so it doesn't hear itself", () => {
      // Feedback guard: a speaking flag stops recognition during TTS.
      expect(html).toMatch(/speaking\s*=\s*true/);
      expect(html).toContain("recognition.stop()");
    });

    it("shapes a deep Adam-Smasher voice (deepest voice, low pitch, slow rate)", () => {
      expect(html).toContain("getVoices()");
      expect(html).toMatch(/\.pitch\s*=\s*0\.1/);
      expect(html).toMatch(/\.rate\s*=\s*0\.85/);
    });
  });
});
