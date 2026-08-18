import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The command-deck dashboard (public/index.html) is a static asset served by the
// worker, not a module — so, like dashboard.test.ts, these are string-presence
// checks on the served HTML. They guard the hand-wired hands-free "ADAM" voice
// against a mockup regeneration silently dropping it; runtime behavior (the mic,
// the actual speech) is verified in-browser, not here.
const html = readFileSync(
  fileURLToPath(new URL("../public/index.html", import.meta.url)),
  "utf8",
);

describe("command-deck voice (hands-free ADAM)", () => {
  it("wires the Web Speech API for always-on STT", () => {
    expect(html).toContain("webkitSpeechRecognition");
    expect(html).toMatch(/continuous\s*=\s*true/);
  });

  it("gates on the ADAM wake word and takes the command after it", () => {
    expect(html).toMatch(/indexOf\(['"]adam['"]\)/);
  });

  it("stops retrying when the mic is denied (no tight restart loop)", () => {
    expect(html).toContain("not-allowed");
  });

  it("sends the heard command to the live /message loop", () => {
    expect(html).toContain("/message");
    expect(html).toMatch(/channel:\s*['"]web['"]/);
  });

  it("shows the live reply in the JARVIS panel instead of the canned demo line", () => {
    // renderVals must prefer a live reply over the cycled utterance.
    expect(html).toMatch(/liveReply\s*\|\|/);
  });

  it("speaks replies in a deep voice with the mic feedback guard", () => {
    expect(html).toContain("SpeechSynthesisUtterance");
    expect(html).toContain("getVoices()");
    expect(html).toMatch(/\.pitch\s*=\s*0\.1/);
    expect(html).toMatch(/\.rate\s*=\s*0\.85/);
    expect(html).toContain("recognition.stop()");
  });
});
