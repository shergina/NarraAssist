// Owner: Person 1. One room per meeting, kept in memory. A server restart clears their contents, but any
// well-formed code is re-created on first use, so open pages survive a restart (the dev server restarts on every save).
import { randomInt } from "node:crypto";
import { HttpError } from "./errors.js";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const rooms = new Map();

const CODE = /^[A-Z0-9]{4,24}$/;

// "884 076 2216" or "abc-123" -> "8840762216" / "ABC123". Pages and sockets send the raw text; be forgiving.
export const normalizeCode = (id) => String(id || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function createRoom(wanted) {
  let id = normalizeCode(wanted);
  if (!CODE.test(id) || rooms.has(id)) {
    do id = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    while (rooms.has(id));
  }
  const room = {
    id,
    deck: { status: "none", fileName: null, error: null, slideCount: 0 },
    pdf: null,
    summary: "",
    slides: [],
    current: null,
    transcript: [],
    clients: new Set(),
    pending: new Map(),
    cue: { lastCheckAt: 0, lastNudgeAt: 0 },
  };
  rooms.set(id, room);
  return room;
}

// Unknown but well-formed codes are created on the spot, so a page that outlives a server restart keeps working.
export function findRoom(id) {
  const code = normalizeCode(id);
  if (rooms.has(code)) return rooms.get(code);
  if (!CODE.test(code)) return null;
  console.log(`[room] ${code} created on first use`);
  return createRoom(code);
}

export function getRoom(id) {
  const room = findRoom(id);
  if (!room) throw new HttpError(404, "That doesn't look like a room code. Use the link from Create room.");
  return room;
}

export function publicState(room) {
  const { id, deck, summary, slides, current } = room;
  return { id, deck, summary, slides, current, transcript: room.transcript.slice(-100) };
}

export function broadcast(room, message, { role } = {}) {
  const data = JSON.stringify(message);
  for (const client of room.clients) {
    if (role && client.role !== role) continue;
    if (client.ws.readyState === 1) client.ws.send(data);
  }
}

export function slideByNumber(room, number) {
  return room.slides.find((s) => s.number === number) || null;
}

export function setCurrentSlide(room, slide, source) {
  const a = room.current;
  // Two deck pages are the same slide when their numbers match. Two screenshots are the same slide only when
  // their text matches too, so consecutive slides that share a title still count as a change.
  const fromDeck = (s) => s.number != null && !s.text?.length === false && room.slides.includes(s);
  const same = a && slide && (fromDeck(a) && fromDeck(slide) ? a.number === slide.number : a.title === slide.title && (a.text || "") === (slide.text || ""));
  if (same) return false;
  room.current = slide;
  broadcast(room, { type: "slide", slide, source });
  return true;
}

export function addTranscript(room, text) {
  const entry = { at: Date.now(), text };
  room.transcript.push(entry);
  if (room.transcript.length > 1000) room.transcript.shift();
  broadcast(room, { type: "transcript", entry });
  return entry;
}
