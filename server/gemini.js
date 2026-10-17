// Owner: Person 1. Every Gemini call goes through this file.
// Each function returns the shape in docs/ARCHITECTURE.md. Until a real version is written,
// it uses mock data when MOCK_GEMINI=1 or there is no key, and answers 501 otherwise.
import { GoogleGenAI, Type } from "@google/genai";
import { HttpError } from "./errors.js";
import * as mock from "./mock-gemini.js";
import * as prompts from "./prompts.js";

export const models = {
  main: process.env.GEMINI_MODEL || "gemini-flash-latest",
  fast: process.env.GEMINI_FAST_MODEL || "gemini-flash-lite-latest",
};

const useMock = process.env.MOCK_GEMINI === "1" || !process.env.GEMINI_API_KEY;
export const client = useMock ? null : new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
export const status = () => (useMock ? "mock" : "live");

const inline = (bytes, mimeType) => ({ inlineData: { mimeType, data: Buffer.from(bytes).toString("base64") } });

async function generateJson(model, parts, schema) {
  const res = await client.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: { responseMimeType: "application/json", responseSchema: schema },
  });
  const usage = res.usageMetadata;
  console.log(`[gemini] ${model} ${usage?.totalTokenCount ?? "?"} tokens`);
  return JSON.parse(res.text);
}

const SLIDE_FIELDS = {
  title: { type: Type.STRING },
  slideNumber: { type: Type.INTEGER },
  text: { type: Type.STRING },
  visuals: { type: Type.STRING },
  overview: { type: Type.STRING },
};

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

// JPEG bytes -> { isSharedContent, title, slideNumber, text, visuals, overview }
// Uses the main model. The fast model was 2 s quicker but miscounted people in a photo on every run
// and leaked the title into the spoken text. Descriptions are made in the background, so 3 to 4 s is fine.
export async function describeFrame(jpeg) {
  if (useMock) return mock.describeFrame(jpeg);
  const schema = {
    type: Type.OBJECT,
    properties: { isSharedContent: { type: Type.BOOLEAN }, ...SLIDE_FIELDS },
    required: ["isSharedContent", ...Object.keys(SLIDE_FIELDS)],
  };
  return generateJson(models.main, [inline(jpeg, "image/jpeg"), { text: prompts.DESCRIBE_FRAME }], schema);
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
