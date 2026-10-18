// Owner: Person 1. Saves each room's uploaded deck to disk and loads it back on start, so a deck uploaded
// the day before survives server restarts. One JSON file plus one PDF per room, under DATA_DIR (default ./data).
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = process.env.DATA_DIR || fileURLToPath(new URL("../data", import.meta.url));
const jsonPath = (id) => join(DATA_DIR, `${id}.json`);
const pdfPath = (id) => join(DATA_DIR, `${id}.pdf`);

export function saveDeck(room) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const { id, deck, summary, slides } = room;
    writeFileSync(jsonPath(id), JSON.stringify({ id, deck, summary, slides, savedAt: new Date().toISOString() }));
    if (room.pdf) writeFileSync(pdfPath(id), room.pdf);
    console.log(`[store] saved deck for ${id} (${slides.length} slides)`);
  } catch (err) {
    console.warn(`[store] could not save ${room.id}:`, err.message);
  }
}

export function clearDeck(id) {
  for (const p of [jsonPath(id), pdfPath(id)]) if (existsSync(p)) unlinkSync(p);
}

// Returns the saved fields for a room id, or null.
export function loadDeck(id) {
  try {
    if (!existsSync(jsonPath(id))) return null;
    const saved = JSON.parse(readFileSync(jsonPath(id), "utf8"));
    const pdf = existsSync(pdfPath(id)) ? readFileSync(pdfPath(id)) : null;
    return { deck: saved.deck, summary: saved.summary, slides: saved.slides, pdf };
  } catch (err) {
    console.warn(`[store] could not load ${id}:`, err.message);
    return null;
  }
}

export function savedRoomIds() {
  try {
    return readdirSync(DATA_DIR).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
}
