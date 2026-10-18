// Owner: Person 1. Turns the listener's streamed 16 kHz mono 16-bit PCM into transcript lines.
import * as gemini from "./gemini.js";
import { addTranscript } from "./rooms.js";
import { maybeCheckCues } from "./cues.js";

const SAMPLE_RATE = 16_000;
const CHUNK_BYTES = SAMPLE_RATE * 2 * 6;
const buffers = new WeakMap();

export function pushAudio(room, data) {
  let state = buffers.get(room);
  if (!state) buffers.set(room, (state = { chunks: [], bytes: 0, queue: Promise.resolve() }));
  state.chunks.push(Buffer.from(data));
  state.bytes += data.length;
  if (state.bytes < CHUNK_BYTES) return;

  const pcm = Buffer.concat(state.chunks);
  state.chunks = [];
  state.bytes = 0;
  // Silence costs a Gemini call and tempts the model to invent words, so skip it.
  if (isSilent(pcm)) return;
  state.queue = state.queue
    .then(async () => {
      const text = await gemini.transcribe(toWav(pcm));
      if (!text) return;
      addTranscript(room, text);
      await maybeCheckCues(room);
    })
    .catch((err) => console.warn("[transcribe]", err.message));
}

// Quiet speech sits around -40 dBFS (RMS about 330 of 32768); room noise and a muted mic sit well below that.
const SILENCE_RMS = 200;
function isSilent(pcm) {
  let sum = 0;
  const samples = Math.floor(pcm.length / 2);
  for (let i = 0; i < samples; i++) sum += pcm.readInt16LE(i * 2) ** 2;
  return Math.sqrt(sum / Math.max(samples, 1)) < SILENCE_RMS;
}

function toWav(pcm) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
