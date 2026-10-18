// Owner: Person 1. Decides when to nudge the presenter.
import { randomUUID } from "node:crypto";
import * as gemini from "./gemini.js";
import { addPending } from "./rooms.js";

const CHECK_EVERY_MS = 15_000;
const NUDGE_COOLDOWN_MS = 45_000;

// Phrases that point at the screen without saying what is on it. Checked locally on each new transcript line
// while something is shared, so the obvious cases nudge at once, without waiting for or depending on Gemini.
const POINTING = [
  /\bas (?:you|we)(?: can| will|'ll)? see\b/i,
  /\byou(?: can|'ll| will)? see (?:here|this|that|these|those|there|on (?:the|this|my) (?:slide|screen))\b/i,
  /\b(?:take a )?look (?:at|over) (?:this|that|these|those|here|there|the (?:slide|screen|chart|graph|numbers|image|picture|diagram|table))\b/i,
  /\bif you look\b/i,
  /\byou(?:'ll| will| can| might) notice\b/i,
  /\b(?:shown|see|seen) (?:here|above|below|on (?:the|this) (?:slide|screen))\b/i,
  /\bas (?:shown|pictured|illustrated)\b/i,
  /\b(?:over|right|up|down) here\b/i,
  /\b(?:this|that) (?:chart|graph|image|picture|photo|diagram|table|figure|map|screenshot|one) (?:here|over here|right here|shows|says)\b/i,
  /\b(?:the|this|that) (?:red|blue|green|yellow|orange|purple|pink|gray|grey) (?:one|line|bar|box|part|area|section|dot)s?\b/i,
  /\b(?:on|at) the (?:left|right|top|bottom)(?: side)? of (?:the|this|my) (?:slide|screen|chart|graph|page)\b/i,
  /\b(?:on|at) the (?:left|right|top|bottom)(?: side)?(?=\s*(?:[,.;!?]|$))/i,
];

export function pointingPhrase(text = "") {
  for (const re of POINTING) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

export async function maybeCheckCues(room, { force = false } = {}) {
  const now = Date.now();
  if (!force && now - room.cue.lastNudgeAt < NUDGE_COOLDOWN_MS) return;

  // force (the dev transcript route) skips the "something is shared" rule, so nudges can be tested with no screen.
  const phrase = room.current || force ? pointingPhrase(room.transcript.at(-1)?.text) : null;
  if (phrase) {
    return nudge(room, {
      cue: "visuals",
      reason: `You said "${phrase}", but some attendees can't see your screen.`,
      suggestion: room.current?.title ? `On this slide, "${room.current.title}", what you're looking at is…` : "What's on screen right now is…",
    });
  }

  if (!force && now - room.cue.lastCheckAt < CHECK_EVERY_MS) return;
  room.cue.lastCheckAt = now;
  const transcript = room.transcript.filter((t) => t.at > now - 60_000).map((t) => t.text).join(" ");
  if (!transcript) return;
  const result = await gemini.detectCue({ slide: room.current, transcript, dismissed: room.cue.dismissed });
  if (result.shouldNudge) nudge(room, result);
}

function nudge(room, { cue, reason, suggestion }) {
  const now = Date.now();
  room.cue.lastNudgeAt = now;
  addPending(room, { id: randomUUID(), kind: "nudge", cue, reason, suggestion, slide: room.current?.number ?? null, at: now });
}
