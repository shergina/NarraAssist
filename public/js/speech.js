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

// Chrome's built-in voice has a quirk: a cancel() followed by speak() in the same instant sometimes drops the
// new text and keeps reading the old one. So: silence the old reading's callbacks, cancel, wait a moment, then speak.
const CANCEL_SETTLE_MS = 120;

export class Speaker {
  #active = null;
  #pending = null;

  // Returns true if onEnd will fire when speech finishes.
  speak(text, { onEnd } = {}) {
    this.cancel();
    if (settings.get("speech.mode") === "screen-reader" || !("speechSynthesis" in window)) {
      announce(text, { assertive: true });
      return false;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = settings.get("voice.rate");
    utterance.onend = utterance.onerror = () => {
      if (this.#active !== utterance) return; // an older reading ending must not trigger a newer one's onEnd
      this.#active = null;
      onEnd?.();
    };
    this.#active = utterance;
    this.#pending = setTimeout(() => {
      this.#pending = null;
      if (this.#active !== utterance) return;
      speechSynthesis.resume(); // Chrome can get stuck paused after a cancel
      speechSynthesis.speak(utterance);
    }, CANCEL_SETTLE_MS);
    return true;
  }

  cancel() {
    clearTimeout(this.#pending);
    this.#pending = null;
    if (this.#active) this.#active.onend = this.#active.onerror = null;
    this.#active = null;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }
}
