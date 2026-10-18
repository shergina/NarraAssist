// Owner: Person 1. Web Push to presenter phones, so a prompt arrives even with the page closed or the phone locked.
// No npm dependency: pushes carry no payload, so nothing needs encrypting. Each push only wakes the service worker
// (public/sw.js), which then asks POST /api/push/pending what is waiting. Requests are signed with a VAPID key
// (ES256 JWT, RFC 8292) made once and kept in DATA_DIR/push/vapid.json, so phones stay subscribed across restarts.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./store.js";

// Its own folder: every .json directly in DATA_DIR is read back as a saved room.
const PUSH_DIR = join(DATA_DIR, "push");
const KEY_FILE = join(PUSH_DIR, "vapid.json");
const SUBS_FILE = join(PUSH_DIR, "subscriptions.json");
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:narraassist@example.com";
// The server POSTs to whatever endpoint a page hands it, so only accept the browsers' real push services.
const PUSH_HOSTS = [/\.googleapis\.com$/, /\.mozilla\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/];

function loadKey() {
  try {
    if (existsSync(KEY_FILE)) return createPrivateKey({ key: JSON.parse(readFileSync(KEY_FILE, "utf8")), format: "jwk" });
  } catch (err) {
    console.warn("[push] could not read the VAPID key, making a new one:", err.message);
  }
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  try {
    mkdirSync(PUSH_DIR, { recursive: true });
    writeFileSync(KEY_FILE, JSON.stringify(privateKey.export({ format: "jwk" })));
  } catch (err) {
    console.warn("[push] could not save the VAPID key; phones must turn notifications on again after a restart:", err.message);
  }
  return privateKey;
}

const privateKey = loadKey();
const { x, y } = createPublicKey(privateKey).export({ format: "jwk" });
// Uncompressed P-256 point, base64url: what pushManager.subscribe() wants as applicationServerKey.
export const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(x, "base64url"), Buffer.from(y, "base64url")]).toString("base64url");

// endpoint -> room id. One browser has one endpoint; the room it last subscribed from wins.
const subscribers = new Map(loadSubscribers());

function loadSubscribers() {
  try {
    return existsSync(SUBS_FILE) ? Object.entries(JSON.parse(readFileSync(SUBS_FILE, "utf8"))) : [];
  } catch {
    return [];
  }
}

function saveSubscribers() {
  try {
    mkdirSync(PUSH_DIR, { recursive: true });
    writeFileSync(SUBS_FILE, JSON.stringify(Object.fromEntries(subscribers)));
  } catch (err) {
    console.warn("[push] could not save subscriptions:", err.message);
  }
}

export function isPushEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}

export function subscribe(room, endpoint) {
  subscribers.set(endpoint, room.id);
  saveSubscribers();
}

export function unsubscribe(endpoint) {
  if (subscribers.delete(endpoint)) saveSubscribers();
}

export const roomIdFor = (endpoint) => subscribers.get(endpoint) || null;

// Wake every phone subscribed to this room. Never throws: a failed push must not stop the nudge.
export function notifyPresenters(room) {
  for (const [endpoint, roomId] of subscribers) {
    if (roomId === room.id) send(endpoint).catch((err) => console.warn("[push]", err.message));
  }
}

async function send(endpoint) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      TTL: "120", // a prompt older than two minutes is stale, so the push service may drop it
      Urgency: "high",
      Authorization: `vapid t=${vapidToken(new URL(endpoint).origin)}, k=${publicKey}`,
      "Content-Length": "0",
    },
  });
  if (res.status === 404 || res.status === 410) {
    unsubscribe(endpoint); // the browser dropped this subscription
    console.log(`[push] removed an expired subscription (${new URL(endpoint).hostname})`);
  }
  else if (!res.ok) console.warn(`[push] ${new URL(endpoint).hostname} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const tokens = new Map(); // push service origin -> { token, exp }
function vapidToken(audience) {
  const now = Math.floor(Date.now() / 1000);
  const cached = tokens.get(audience);
  if (cached && cached.exp - 3600 > now) return cached.token;
  const exp = now + 12 * 3600;
  const part = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: audience, exp, sub: SUBJECT })}`;
  const signature = sign("sha256", Buffer.from(unsigned), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  const token = `${unsigned}.${signature}`;
  tokens.set(audience, { token, exp });
  return token;
}
