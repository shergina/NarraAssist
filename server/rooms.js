// Owner: Person 1. One room per meeting, kept in memory. A server restart clears all rooms.
import { randomInt } from "node:crypto";
import { HttpError } from "./errors.js";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const rooms = new Map();

export function createRoom() {
  let id;
  do id = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  while (rooms.has(id));
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

export function findRoom(id) {
  return rooms.get(String(id || "").trim().toUpperCase()) || null;
}

export function getRoom(id) {
  const room = findRoom(id);
  if (!room) throw new HttpError(404, "No room with that code. Rooms reset when the server restarts.");
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
  const same = a && slide && (a.number != null || slide.number != null ? a.number === slide.number : a.title === slide.title);
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
