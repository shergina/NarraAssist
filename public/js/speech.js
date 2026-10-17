// Owner: Person 3. All speech and screen reader announcements go through here.
import { settings } from "./settings.js";

const pendingAnnouncements = new WeakMap();

export function announce(text, { assertive = false } = {}) {
  const region = document.getElementById(assertive ? "sr-alert" : "sr-status");
  if (!region) return;
  clearTimeout(pendingAnnouncements.get(region));
  region.textContent = "";
  const timer = setTimeout(() => {
    region.textContent = text;
    pendingAnnouncements.delete(region);
  }, 60);
  pendingAnnouncements.set(region, timer);
}

export class Speaker {
  constructor() {
    this.active = null;
    this.generation = 0;
  }

  // Returns true if onEnd will fire when speech finishes.
  speak(text, { onEnd } = {}) {
    this.cancel();
    if (settings.get("speech.mode") === "screen-reader" || !("speechSynthesis" in window)) {
      announce(text, { assertive: true });
      return false;
    }

    const generation = this.generation;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = settings.get("voice.rate");
    utterance.onend = utterance.onerror = () => {
      if (this.generation !== generation || this.active !== utterance) return;
      this.active = null;
      onEnd?.();
    };
    this.active = utterance;
    speechSynthesis.speak(utterance);
    return true;
  }

  cancel() {
    this.generation += 1;
    if (this.active) this.active.onend = this.active.onerror = null;
    this.active = null;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }
}
