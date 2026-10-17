// Owner: Person 1. HTTP routes. Contracts: docs/ARCHITECTURE.md.
import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import * as gemini from "./gemini.js";
import { HttpError } from "./errors.js";
import { createRoom, getRoom, publicState, broadcast, setCurrentSlide, slideByNumber, addTranscript } from "./rooms.js";
import { attachSockets } from "./sockets.js";
import { maybeCheckCues } from "./cues.js";
import { zoomRouter } from "./zoom.js";

const PORT = Number(process.env.PORT || 3000);
const app = express();

app.use(express.static(fileURLToPath(new URL("../public", import.meta.url)), { extensions: ["html"] }));
app.use(express.json({ limit: "1mb" }));
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
  let slide = null;
  if (room.slides.length) {
    const match = await gemini.matchSlide(req.body, room.slides);
    if (match.slideNumber > 0 && match.confidence >= 0.5) slide = slideByNumber(room, match.slideNumber);
  } else {
    const d = await gemini.describeFrame(req.body);
    if (d.isSharedContent) slide = { number: null, title: d.title, text: d.text, visuals: d.visuals, overview: d.overview };
  }
  const changed = slide ? setCurrentSlide(room, slide, "screen") : false;
  res.json({ changed, slide: room.current });
});

app.post("/api/rooms/:id/ask", async (req, res) => {
  const room = getRoom(req.params.id);
  const question = String(req.body?.question || "").trim();
  if (!question) throw new HttpError(400, "Ask a question.");
  const transcript = room.transcript.slice(-15).map((t) => t.text).join(" ");
  res.json({ answer: await gemini.answerQuestion({ question, pdf: room.pdf, slide: room.current, transcript }) });
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

const server = createServer(app);
attachSockets(server);
server.listen(PORT, () => {
  console.log(`\nZoomInSight running at http://localhost:${PORT}`);
  console.log(`Gemini: ${gemini.status() === "mock" ? "mock data (set MOCK_GEMINI=0 and a key for real calls)" : "live"}`);
});
