// Owner: Person 1. Every Gemini call goes through this file.
// Each function returns the shape in docs/ARCHITECTURE.md. Until a real version is written,
// it uses mock data when MOCK_GEMINI=1 or there is no key, and answers 501 otherwise.
import { GoogleGenAI } from "@google/genai";
import { HttpError } from "./errors.js";
import * as mock from "./mock-gemini.js";

export const models = {
  main: process.env.GEMINI_MODEL || "gemini-flash-latest",
  fast: process.env.GEMINI_FAST_MODEL || "gemini-flash-lite-latest",
};

const useMock = process.env.MOCK_GEMINI === "1" || !process.env.GEMINI_API_KEY;
export const client = useMock ? null : new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
export const status = () => (useMock ? "mock" : "live");

function notBuilt(name) {
  throw new HttpError(501, `${name} isn't built yet (Person 1). Set MOCK_GEMINI=1 in .env to use mock data.`);
}

// PDF bytes -> { summary, slides: [{ number, title, text, visuals, overview }] }
export async function processDeck(pdf) {
  if (useMock) return mock.processDeck(pdf);
  notBuilt("processDeck");
}

// JPEG bytes, deck slides -> { slideNumber, confidence }
export async function matchSlide(jpeg, slides) {
  if (useMock) return mock.matchSlide(jpeg, slides);
  notBuilt("matchSlide");
}

// JPEG bytes -> { isSharedContent, title, text, visuals, overview }
export async function describeFrame(jpeg) {
  if (useMock) return mock.describeFrame(jpeg);
  notBuilt("describeFrame");
}

// WAV bytes -> transcript text, or "" for no speech
export async function transcribe(wav) {
  if (useMock) return mock.transcribe(wav);
  notBuilt("transcribe");
}

// { slide, transcript, dismissed } -> { shouldNudge, cue: "visuals" | "share-file" | "self-description" | "none", reason, suggestion }
export async function detectCue(input) {
  if (useMock) return mock.detectCue(input);
  notBuilt("detectCue");
}

// { question, pdf, slide, transcript } -> answer text
export async function answerQuestion(input) {
  if (useMock) return mock.answerQuestion(input);
  notBuilt("answerQuestion");
}
