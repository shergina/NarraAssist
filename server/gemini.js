// Owner: Person 1. Every Gemini call goes through this file.
// Each function returns the shape in docs/ARCHITECTURE.md. Until a real version is written,
// it uses mock data when MOCK_GEMINI=1 or there is no key.
import { GoogleGenAI, Type } from "@google/genai";
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

// fast: true turns the model's thinking off. On our screenshot tests that halved the time (about 2.5 s)
// with no loss in accuracy. If a model version rejects the setting, the call is retried without it.
const rejectsThinkingOff = new Set(); // models that refused thinkingConfig, so we stop sending it to them

async function generateJson(model, parts, schema, { fast = false } = {}) {
  const config = { responseMimeType: "application/json", responseSchema: schema };
  if (fast && !rejectsThinkingOff.has(model)) config.thinkingConfig = { thinkingBudget: 0 };
  const started = Date.now();
  let res;
  try {
    res = await client.models.generateContent({ model, contents: [{ role: "user", parts }], config });
  } catch (err) {
    // Some models (Flash-Lite among them) reject thinkingConfig with a bare "invalid argument".
    if (!config.thinkingConfig || !/thinking|INVALID_ARGUMENT|invalid argument/i.test(err.message)) throw err;
    rejectsThinkingOff.add(model);
    console.warn(`[gemini] ${model} rejected the thinking-off setting; retrying without it and not sending it again`);
    delete config.thinkingConfig;
    res = await client.models.generateContent({ model, contents: [{ role: "user", parts }], config });
  }
  console.log(`[gemini] ${model} ${res.usageMetadata?.totalTokenCount ?? "?"} tokens ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return JSON.parse(res.text);
}

const SLIDE_FIELDS = {
  title: { type: Type.STRING },
  slideNumber: { type: Type.INTEGER },
  text: { type: Type.STRING },
  visuals: { type: Type.STRING },
  overview: { type: Type.STRING },
  summary: { type: Type.STRING },
};


// PDF bytes -> { summary, slides: [{ number, title, text, visuals, overview, summary }] }
// Main model with its thinking left on: a whole deck in one call is worth the extra seconds.
export async function processDeck(pdf) {
  if (useMock) return mock.processDeck(pdf);
  const schema = {
    type: Type.OBJECT,
    properties: {
      deckSummary: { type: Type.STRING },
      pages: {
        type: Type.ARRAY,
        items: { type: Type.OBJECT, properties: SLIDE_FIELDS, required: Object.keys(SLIDE_FIELDS) },
      },
    },
    required: ["deckSummary", "pages"],
  };
  const out = await generateJson(models.main, [inline(pdf, "application/pdf"), { text: prompts.DESCRIBE_DECK }], schema);
  const slides = out.pages
    .map((p, i) => ({ number: p.slideNumber || i + 1, title: p.title, text: p.text, visuals: p.visuals, overview: p.overview, summary: p.summary }))
    .sort((a, b) => a.number - b.number);
  return { summary: out.deckSummary, slides };
}

// JPEG bytes, deck slides -> { slideNumber, confidence }. Fast model, thinking off: this runs on every slide change.
export async function matchSlide(jpeg, slides) {
  if (useMock) return mock.matchSlide(jpeg, slides);
  const schema = {
    type: Type.OBJECT,
    properties: { slideNumber: { type: Type.INTEGER }, confidence: { type: Type.NUMBER } },
    required: ["slideNumber", "confidence"],
  };
  return generateJson(models.fast, [inline(jpeg, "image/jpeg"), { text: prompts.matchSlide(slides) }], schema, { fast: true });
}

// JPEG bytes -> { isSharedContent, title, slideNumber, text, visuals, overview, summary }
// Uses the main model with thinking off, about 2.5 s. Flash-Lite was no faster than that and
// miscounted people in a photo on every run and leaked the title into the spoken text.
export async function describeFrame(jpeg) {
  if (useMock) return mock.describeFrame(jpeg);
  const schema = {
    type: Type.OBJECT,
    properties: { isSharedContent: { type: Type.BOOLEAN }, ...SLIDE_FIELDS },
    required: ["isSharedContent", ...Object.keys(SLIDE_FIELDS)],
  };
  return generateJson(models.main, [inline(jpeg, "image/jpeg"), { text: prompts.DESCRIBE_FRAME }], schema, { fast: true });
}

// WAV bytes -> transcript text, or "" for no speech. Fast model, thinking off: a chunk arrives every 6 seconds.
export async function transcribe(wav) {
  if (useMock) return mock.transcribe(wav);
  const schema = { type: Type.OBJECT, properties: { text: { type: Type.STRING } }, required: ["text"] };
  const out = await generateJson(models.fast, [inline(wav, "audio/wav"), { text: prompts.TRANSCRIBE }], schema, { fast: true });
  return (out.text || "").trim();
}

// { slide, transcript, dismissed } -> { shouldNudge, cue: "visuals" | "share-file" | "self-description" | "none", reason, suggestion }
export async function detectCue({ slide, transcript, dismissed = [] }) {
  if (useMock) return mock.detectCue({ slide, transcript, dismissed });
  const schema = {
    type: Type.OBJECT,
    properties: {
      shouldNudge: { type: Type.BOOLEAN },
      cue: { type: Type.STRING, enum: ["visuals", "share-file", "self-description", "none"] },
      reason: { type: Type.STRING },
      suggestion: { type: Type.STRING },
    },
    required: ["shouldNudge", "cue", "reason", "suggestion"],
  };
  const slideText = slide
    ? `Title: ${slide.title || "(none)"}\nText: ${slide.text || "(none)"}\nVisuals: ${slide.visuals || "(none)"}`
    : "(nothing is shared)";
  const parts = [{
    text: `${prompts.DETECT_CUE}\n\nCurrent slide:\n${slideText}\n\nDismissed kinds: ${dismissed.length ? dismissed.join(", ") : "(none)"}\n\nLast minute of the presenter:\n${transcript}`,
  }];
  const out = await generateJson(models.main, parts, schema, { fast: true });
  const nudge = out.shouldNudge && out.cue !== "none" && !dismissed.includes(out.cue);
  return nudge
    ? { shouldNudge: true, cue: out.cue, reason: (out.reason || "").trim(), suggestion: (out.suggestion || "").trim() }
    : { shouldNudge: false, cue: "none", reason: "", suggestion: "" };
}

// { question, slides, history } -> { found, answer, slideNumbers }. Main model with thinking on: accuracy over speed.
export async function answerQuestion(input) {
  if (useMock) return mock.answerQuestion(input);
  const schema = {
    type: Type.OBJECT,
    properties: {
      found: { type: Type.BOOLEAN },
      answer: { type: Type.STRING },
      slideNumbers: { type: Type.ARRAY, items: { type: Type.INTEGER } },
    },
    required: ["found", "answer", "slideNumbers"],
  };
  return generateJson(models.main, [{ text: prompts.answerQuestion(input) }], schema);
}
