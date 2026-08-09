// WhatsApp Cloud API gateway. Outbound sendText is a plain-fetch adapter
// mirroring github.ts (Bearer token, throw on non-ok). Inbound parsing and the
// two trust-boundary checks (verify-token + HMAC signature) are pure functions.

import { createHmac, timingSafeEqual } from "node:crypto";

type FetchFn = typeof fetch;

interface Config {
  token: string;
  phoneNumberId: string;
  fetchFn?: FetchFn;
}

export interface WhatsappClient {
  sendText(to: string, body: string): Promise<unknown>;
}

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export function whatsappClient(config: Config): WhatsappClient {
  const { token, phoneNumberId, fetchFn = fetch } = config;
  return {
    sendText: async (to: string, body: string) => {
      const res = await fetchFn(`${GRAPH_BASE}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
      });
      if (!res.ok) throw new Error(`whatsapp send failed: ${res.status} ${await res.text()}`);
      return res.json();
    },
  };
}

/**
 * Dig the first inbound text message out of a webhook payload, else null.
 * Status callbacks (delivered/read) and non-text messages (image, audio…)
 * return null so callers only act on real user text.
 */
export function parseInboundMessage(webhookBody: unknown): { from: string; text: string } | null {
  const entry = (webhookBody as { entry?: unknown })?.entry;
  if (!Array.isArray(entry)) return null;
  for (const e of entry) {
    const changes = (e as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const c of changes) {
      const messages = (c as { value?: { messages?: unknown } })?.value?.messages;
      if (!Array.isArray(messages)) continue;
      for (const m of messages) {
        const msg = m as { from?: unknown; type?: unknown; text?: { body?: unknown } };
        if (msg.type === "text" && typeof msg.from === "string" && typeof msg.text?.body === "string") {
          return { from: msg.from, text: msg.text.body };
        }
      }
    }
  }
  return null;
}

/**
 * Webhook verification handshake (Meta GET /webhook). Echo the challenge iff
 * mode is "subscribe" and the caller's token matches ours — else null (403).
 */
export function verifyWebhook(
  query: { mode?: string; token?: string; challenge?: string },
  verifyToken: string,
): string | null {
  if (query.mode === "subscribe" && query.token === verifyToken && query.challenge !== undefined) {
    return query.challenge;
  }
  return null;
}

/**
 * Trust boundary: verify the X-Hub-Signature-256 header ("sha256=<hex>") is an
 * HMAC-SHA256 of the raw request body keyed by the app secret. Constant-time
 * compare so a bad signature leaks no timing signal. Malformed/missing → false.
 */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const got = Buffer.from(signatureHeader.slice("sha256=".length), "hex");
  // Length guard first — timingSafeEqual throws on mismatched lengths.
  return got.length === expected.length && timingSafeEqual(got, expected);
}
