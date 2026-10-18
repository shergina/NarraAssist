// Owner: Person 3. App preferences, saved in this browser. Every sound and announcement defaults to on.
import { h } from "./common.js";

const DEFAULTS = {
  "sound.slideChanged": true,
  "sound.presenterQuiet": true,
  "sound.caughtUp": true,
  "announce.speaker": true,
  "announce.slideTitle": true,
  "voice.rate": 1.2,
  "catchup.maxRate": 2,
  "speech.mode": "voice", // "voice" | "screen-reader"
  "display.highContrast": false,
  "display.largeText": false,
};

export const settings = {
  get(key) {
    try {
      const raw = localStorage.getItem(`zis.${key}`);
      return raw == null ? DEFAULTS[key] : JSON.parse(raw);
    } catch {
      return DEFAULTS[key];
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`zis.${key}`, JSON.stringify(value));
    } catch {
      // Storage blocked: keep working with defaults.
    }
  },
  keys: Object.keys(DEFAULTS),
};

export function applyDisplaySettings() {
  const root = document.documentElement;
  root.dataset.contrast = settings.get("display.highContrast") ? "high" : "standard";
  root.dataset.textSize = settings.get("display.largeText") ? "large" : "standard";
}

export function appearanceSettings() {
  const toggle = (key, label) => h("label", { class: "setting-toggle" },
    h("input", {
      type: "checkbox",
      checked: settings.get(key),
      onchange: (event) => {
        settings.set(key, event.target.checked);
        applyDisplaySettings();
      },
    }),
    h("span", {}, label));

  return h("fieldset", { class: "settings-group" },
    h("legend", {}, "Display and text"),
    toggle("display.highContrast", "Use high contrast colors"),
    toggle("display.largeText", "Use larger text"));
}
