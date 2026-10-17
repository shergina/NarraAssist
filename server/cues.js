// Owner: Person 1. Decides when to nudge the presenter.
// TODO(Person 1): feed dismissed cues back in, and only check self-description early in the talk.
import { randomUUID } from "node:crypto";
import * as gemini from "./gemini.js";
import { broadcast } from "./rooms.js";

const CHECK_EVERY_MS = 15_000;
const NUDGE_COOLDOWN_MS = 45_000;

export async function maybeCheckCues(room, { force = false } = {}) {
  const now = Date.now();
  if (!force && (now - room.cue.lastCheckAt < CHECK_EVERY_MS || now - room.cue.lastNudgeAt < NUDGE_COOLDOWN_MS)) return;
  room.cue.lastCheckAt = now;

  const transcript = room.transcript.filter((t) => t.at > now - 60_000).map((t) => t.text).join(" ");
  const result = await gemini.detectCue({ slide: room.current, transcript, dismissed: [] });
  if (!result.shouldNudge) return;

  room.cue.lastNudgeAt = now;
  const nudge = { id: randomUUID(), kind: "nudge", cue: result.cue, reason: result.reason, suggestion: result.suggestion, slide: room.current?.number ?? null, at: now };
  room.pending.set(nudge.id, nudge);
  broadcast(room, { type: "nudge", nudge }, { role: "presenter" });
}
