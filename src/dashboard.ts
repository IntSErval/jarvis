// The single Phase-1 dashboard page (plan Task 4): a box to send a message and
// a live feed of the audit log. Served as one self-contained HTML string by the
// worker's `GET /` route — no framework, no build step, no monorepo split yet.
// ponytail: static page on the existing worker; swap in the Next.js app only
// when the Vercel/worker deploy split (plan Task 5) actually happens.

export function dashboardPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Jarvis — Foundation</title>
  <style>
    body { font: 15px/1.5 system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.1rem; }
    form { display: flex; gap: .5rem; }
    input { flex: 1; padding: .5rem; }
    button { padding: .5rem 1rem; }
    #reply { margin: 1rem 0; min-height: 1.5em; color: #333; }
    .row { border-top: 1px solid #ddd; padding: .5rem 0; font-size: 13px; }
    .row .meta { color: #888; }
    .err { color: #b00; }
    .ok { color: #087; }
    .row button { padding: .2rem .6rem; margin-right: .4rem; font-size: 12px; }
  </style>
</head>
<body>
  <h1>Jarvis — Foundation</h1>
  <form id="send">
    <input id="text" placeholder="Ask Jarvis…" autocomplete="off" autofocus />
    <button type="submit">Send</button>
  </form>
  <div id="mic" title="Say &quot;ADAM&quot; then your command">🎤 starting…</div>
  <div id="reply"></div>
  <h1>Approvals</h1>
  <div id="approvals">loading…</div>
  <h1>Audit feed</h1>
  <div id="feed">loading…</div>
  <script>
    const $ = (id) => document.getElementById(id);

    async function loadFeed() {
      try {
        const res = await fetch("/audit?limit=20");
        const { rows } = await res.json();
        $("feed").innerHTML = rows.length
          ? rows.map((r) =>
              '<div class="row"><span class="meta">' + r.ts + ' · ' + r.channel + ' · ' +
              (r.status === "ok" ? "ok" : '<span class="err">error</span>') + '</span><br>' +
              '<b>' + escapeHtml(r.user_msg) + '</b><br>' + escapeHtml(r.response) + '</div>'
            ).join("")
          : "<div class=\\"row\\">no messages yet</div>";
      } catch (e) {
        $("feed").innerHTML = '<div class="row err">could not load feed</div>';
      }
    }

    function escapeHtml(s) {
      return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    }

    // Approval queue (Phase 4): pending parked writes get approve/deny buttons;
    // decided rows show their outcome (approved/denied, then executed/failed once
    // the write runs). 404 => APPROVALS_FILE unset, so the route isn't mounted.
    async function loadApprovals() {
      try {
        const res = await fetch("/approvals?limit=20");
        if (!res.ok) { $("approvals").innerHTML = '<div class="row meta">approvals off</div>'; return; }
        const { rows } = await res.json();
        $("approvals").innerHTML = rows.length
          ? rows.map(renderApproval).join("")
          : '<div class="row">nothing queued</div>';
      } catch (e) {
        $("approvals").innerHTML = '<div class="row err">could not load approvals</div>';
      }
    }

    function statusLabel(r) {
      if (r.status === "failed") return '<span class="err">failed' + (r.error ? ": " + escapeHtml(r.error) : "") + "</span>";
      if (r.status === "executed") return '<span class="ok">executed</span>';
      return escapeHtml(r.status);
    }

    function renderApproval(r) {
      const controls = r.status === "pending"
        ? '<button data-approve="' + escapeHtml(r.id) + '">approve</button>' +
          '<button data-deny="' + escapeHtml(r.id) + '">deny</button>'
        : "";
      return '<div class="row"><span class="meta">' + r.ts + " · " + escapeHtml(r.tool) + " · " +
        statusLabel(r) + "</span><br>" + escapeHtml(JSON.stringify(r.args)) + "<br>" + controls + "</div>";
    }

    async function decide(id, status) {
      try {
        await fetch("/approvals/" + encodeURIComponent(id), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status }),
        });
      } catch (e) { /* transient — the poll will reconcile */ }
      loadApprovals();
      loadFeed();
    }

    $("approvals").addEventListener("click", (ev) => {
      const approveId = ev.target.getAttribute && ev.target.getAttribute("data-approve");
      const denyId = ev.target.getAttribute && ev.target.getAttribute("data-deny");
      if (approveId) decide(approveId, "approved");
      else if (denyId) decide(denyId, "denied");
    });

    // Voice (hands-free "ADAM"): always-on browser STT via Web Speech API, TTS
    // via speechSynthesis shaped toward a deep Adam-Smasher timbre. No server
    // round-trip for audio — recognition hears the "ADAM" wake word, fills #text
    // with the command after it, and submits through the handler below. voiceQuery
    // marks the reply for read-aloud so typed queries stay silent.
    const WAKE = "adam";
    let voiceQuery = false;
    let speaking = false;   // true while Jarvis is talking — pauses the mic
    let recognition = null;
    let listening = false;
    let micBlocked = false; // a denied mic is terminal — stop retrying

    function startListening() {
      // Hands-free: no button. Guarded so we never double-start, listen while
      // speaking, or spin after a denied mic. try/catch swallows the
      // InvalidStateError of start()-ing twice.
      if (!recognition || listening || speaking || micBlocked) return;
      try { recognition.start(); } catch (e) {}
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const mic = $("mic");
    if (!SR) {
      mic.hidden = true;
    } else {
      recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.onstart = () => { listening = true; mic.textContent = '🔴 Listening for "ADAM"…'; };
      // Chrome drops continuous recognition after silence; restart to stay
      // hands-free, unless we deliberately stopped it to speak (guarded below).
      recognition.onend = () => { listening = false; if (!speaking) startListening(); };
      recognition.onerror = (e) => {
        listening = false;
        if (e && (e.error === "not-allowed" || e.error === "service-not-allowed")) {
          micBlocked = true;   // else onend/startListening spin forever
          mic.textContent = "🔇 mic blocked — allow it and reload";
        }
      };
      recognition.onresult = (ev) => {
        const heard = ev.results[ev.results.length - 1][0].transcript.toLowerCase();
        const at = heard.indexOf(WAKE);
        if (at === -1) return;                               // no wake word — ignore
        const command = heard.slice(at + WAKE.length).replace(/^[,\\s]+/, "").trim();
        if (!command) return;                                // "ADAM" alone — wait
        mic.textContent = "💬 " + command;
        $("text").value = command;
        voiceQuery = true;
        $("send").requestSubmit();
      };
      startListening();   // browser prompts for mic once; every later visit is silent
    }

    // Adam Smasher on a $0 budget: deepest available voice, floor the pitch, slow
    // the rate. Stop the mic while speaking so it doesn't transcribe Jarvis itself.
    // ponytail: speechSynthesis can't be routed through Web Audio for real
    // distortion/vocoder grit in-browser — that's the ceiling; upgrade path is the
    // deferred env-gated ElevenLabs voice-clone adapter (ports & adapters).
    function speak(text) {
      const u = new SpeechSynthesisUtterance(text);
      const vs = speechSynthesis.getVoices();
      const v = vs.find((x) => /\\b(male|daniel|david|rishi)\\b/i.test(x.name))
             || vs.find((x) => /en[-_]?gb/i.test(x.lang)) || vs[0];
      if (v) u.voice = v;
      u.pitch = 0.1;    // floor — deepest the API allows
      u.rate = 0.85;    // heavier, slower cadence
      speaking = true;
      try { recognition && recognition.stop(); } catch (e) {}
      u.onend = () => { speaking = false; startListening(); };
      speechSynthesis.speak(u);
    }

    $("send").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      // Snapshot + clear the voice flag up front so a typed submit that lands
      // while a voice request is still in flight can't inherit its read-aloud.
      const speakReply = voiceQuery;
      voiceQuery = false;
      const text = $("text").value.trim();
      if (!text) return;
      $("reply").textContent = "…";
      try {
        const res = await fetch("/message", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, channel: "web" }),
        });
        const data = await res.json();
        const reply = data.reply ?? data.error ?? "(no reply)";
        $("reply").textContent = reply;
        $("text").value = "";
        if (speakReply && window.speechSynthesis) {
          speak(reply);
        }
        loadFeed();
      } catch (e) {
        $("reply").textContent = "request failed";
      }
    });

    loadFeed();
    loadApprovals();
    setInterval(loadApprovals, 5000);
  </script>
</body>
</html>`;
}
