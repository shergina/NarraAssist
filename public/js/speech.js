// Owner: Person 3. All speech and screen reader announcements go through here.
import { settings } from "./settings.js";

export function announce(text, { assertive = false } = {}) {
  const region = document.getElementById(assertive ? "sr-alert" : "sr-status");
  if (!region) return;
  region.textContent = "";
  setTimeout(() => (region.textContent = text), 60);
}

export class Speaker {
  // Returns true if onEnd will fire when speech finishes.
  speak(text, { onEnd } = {}) {
    if (settings.get("speech.mode") === "screen-reader" || !("speechSynthesis" in window)) {
      announce(text, { assertive: true });
      return false;
    }
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = settings.get("voice.rate");
    utterance.onend = utterance.onerror = () => onEnd?.();
    speechSynthesis.speak(utterance);
    return true;
  }

  cancel() {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }
}
