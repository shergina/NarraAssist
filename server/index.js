// Owner: Person 1. HTTP routes. Contracts: docs/ARCHITECTURE.md.
import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as gemini from "./gemini.js";
import { HttpError } from "./errors.js";
import { createRoom, getRoom, publicState, broadcast, setCurrentSlide, slideByNumber, addTranscript, restoreSavedRooms } from "./rooms.js";
import { saveDeck } from "./store.js";
import { attachSockets } from "./sockets.js";
import { maybeCheckCues } from "./cues.js";
import { zoomRouter } from "./zoom.js";

const PORT = Number(process.env.PORT || 3000);
const app = express();

app.use(express.static(fileURLToPath(new URL("../public", import.meta.url)), { extensions: ["html"] }));
app.use(express.json({ limit: "1mb" }));
// With DEBUG_FRAMES=1, log every API request and socket connection with a timestamp, to see what reaches the server.
const stamp = () => new Date().toTimeString().slice(0, 8);
if (process.env.DEBUG_FRAMES === "1") {
  app.use("/api", (req, res, next) => {
    res.on("finish", () => console.log(`[${stamp()}] ${req.method} ${req.originalUrl} -> ${res.statusCode}`));
    next();
  });
}
app.use("/api/zoom", zoomRouter);

app.get("/api/health", (req, res) => res.json({ ok: true, gemini: gemini.status(), models: gemini.models }));

app.post("/api/rooms", (req, res) => res.status(201).json({ id: createRoom().id }));

app.get("/api/rooms/:id", (req, res) => res.json(publicState(getRoom(req.params.id))));

app.post("/api/rooms/:id/deck", express.raw({ type: "application/pdf", limit: "20mb" }), async (req, res) => {
  const room = getRoom(req.params.id);
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, "Send the PDF as the request body.");
  room.pdf = req.body;
  room.deck = { status: "processing", fileName: decodeURIComponent(req.get("x-file-name") || "slides.pdf"), error: null, slideCount: 0 };
  broadcast(room, { type: "deck", deck: room.deck });
  res.status(202).json({ deck: room.deck });
  try {
    const out = await gemini.processDeck(room.pdf);
    Object.assign(room, { slides: out.slides, summary: out.summary });
    room.deck = { ...room.deck, status: "ready", slideCount: out.slides.length };
    saveDeck(room);
  } catch (err) {
    room.deck = { ...room.deck, status: "error", error: err.message };
  }
  broadcast(room, { type: "deck", deck: room.deck, summary: room.summary, slides: room.slides });
});

app.get("/api/rooms/:id/deck.pdf", (req, res) => {
  const room = getRoom(req.params.id);
  if (!room.pdf) throw new HttpError(404, "No slides uploaded yet.");
  res.type("application/pdf").send(room.pdf);
});

// TODO(Person 1): describe at most once every 3 seconds per room; the newest frame wins.
app.post("/api/rooms/:id/frame", express.raw({ type: "image/jpeg", limit: "8mb" }), async (req, res) => {
  const room = getRoom(req.params.id);
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, "Send a JPEG frame as the request body.");
  // reason tells the page why there is no slide: "nothing-shared" (no content on screen),
  // "no-match" (content on screen but not a page of the uploaded deck), or "described".
  let slide = null;
  let reason = "described";
  if (room.slides.length) {
    const match = await gemini.matchSlide(req.body, room.slides);
    if (match.slideNumber > 0 && match.confidence >= 0.6) slide = slideByNumber(room, match.slideNumber);
  }
  if (!slide) {
    // No deck, or the screen isn't one of its pages (edited slide, a demo, a website): describe the screenshot itself.
    const d = await gemini.describeFrame(req.body);
    if (d.isSharedContent) slide = { number: d.slideNumber || null, title: d.title, text: d.text, visuals: d.visuals, overview: d.overview, summary: d.summary };
    else reason = "nothing-shared";
    if (slide && room.slides.length) reason = "no-match";
  }
  // Slide detection fires a couple of empty frames while a slide change settles, so an empty frame means
  // nothing on its own. Clear the slide only once nothing has been shared for a while.
  const EMPTY_FOR_MS = 8000;
  if (slide) room.lastContentAt = Date.now();
  else if (reason === "nothing-shared" && room.current && Date.now() - (room.lastContentAt || 0) > EMPTY_FOR_MS) {
    room.current = null;
    broadcast(room, { type: "slide", slide: null, source: "screen" });
  }
  const changed = slide ? setCurrentSlide(room, slide, "screen") : false;
  const listeners = [...room.clients].filter((c) => c.role === "listener" && c.ws.readyState === 1).length;
  console.log(`[frame] ${room.id} ${Math.round(req.body.length / 1024)} KB -> ${reason}${slide ? `: "${slide.title}"` : ""}${changed ? ` (new, sent to ${listeners} listener socket${listeners === 1 ? "" : "s"})` : ""}`);
  if (process.env.DEBUG_FRAMES === "1") saveFrame(room, req.body, reason);
  res.json({ changed, reason, slide: room.current });
});

// With DEBUG_FRAMES=1 in .env, every frame is saved so slide detection can be checked by eye.
const FRAME_DIR = join(tmpdir(), "narraassist-frames");
function saveFrame(room, jpeg, reason) {
  try {
    mkdirSync(FRAME_DIR, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${room.id}-${reason}.jpg`;
    writeFileSync(join(FRAME_DIR, name), jpeg);
    console.log(`[frame] saved ${join(FRAME_DIR, name)}`);
  } catch (err) {
    console.warn("[frame] could not save:", err.message);
  }
}

// Questions are answered from the uploaded deck only. The server checks the model's citations: an answer that
// claims to be found but points at no real slide is replaced by "not in the slides", so a bluff has nowhere to point.
const NOT_IN_SLIDES = "That isn't covered in the slides.";
app.post("/api/rooms/:id/ask", async (req, res) => {
  const room = getRoom(req.params.id);
  const question = String(req.body?.question || "").trim().slice(0, 500);
  if (!question) throw new HttpError(400, "Ask a question.");
  if (!room.slides.length) throw new HttpError(409, "No slides have been uploaded yet. Ask the presenter to upload them first.");
  const history = Array.isArray(req.body?.history)
    ? req.body.history.slice(-3).map((h) => ({ question: String(h.question || "").slice(0, 500), answer: String(h.answer || "").slice(0, 1000) }))
    : [];
  const out = await gemini.answerQuestion({ question, slides: room.slides, history });
  const valid = new Set(room.slides.map((s) => s.number));
  const cited = (out.slideNumbers || []).filter((n) => valid.has(n));
  const found = Boolean(out.found && out.answer?.trim() && cited.length);
  if (out.found && !found) console.log(`[ask] ${room.id} answer rejected: no valid slide cited for "${question.slice(0, 60)}"`);
  res.json({ found, answer: found ? out.answer.trim() : NOT_IN_SLIDES, slides: found ? cited : [] });
});

// Development only: add a transcript line and run the cue check now, to test nudges without audio.
app.post("/api/rooms/:id/dev/transcript", async (req, res) => {
  const room = getRoom(req.params.id);
  const entry = addTranscript(room, String(req.body?.text || "As you can see here, the numbers went up."));
  await maybeCheckCues(room, { force: true });
  res.json({ entry });
});

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500 && !(err instanceof HttpError)) console.error(err);
  res.status(status).json({ error: err.message });
});

restoreSavedRooms();
const server = createServer(app);
attachSockets(server);
server.listen(PORT, () => {
  console.log(`\nNarraAssist running at http://localhost:${PORT}`);
  console.log(`Gemini: ${gemini.status() === "mock" ? "mock data (set MOCK_GEMINI=0 and a key for real calls)" : "live"}`);
});
