// Owner: Person 3. App preferences, saved in this browser. Every sound and announcement defaults to on.
// The display options (theme, font, text size, spacing, bold, focus) were extended in Person 4's design pass.
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
  "display.largeText": false, // older setting, kept in step with display.textSize
  "display.textSize": "standard", // "standard" | "large" | "xlarge" | "xxlarge"
  "display.theme": "auto", // "auto" | "light" | "dark"
  "display.font": "standard", // "standard" | "easy" | "atkinson"
  "display.spacing": "standard", // "standard" | "wide" | "widest"
  "display.bold": false,
  "display.bigFocus": false,
  "video.float": true,
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

const CHOICES = {
  "display.theme": [["auto", "Match my device"], ["light", "Light"], ["dark", "Dark"]],
  "display.textSize": [["standard", "Standard"], ["large", "Large (about 140%)"], ["xlarge", "Extra large (175%)"], ["xxlarge", "Largest (200%)"]],
  "display.font": [["standard", "Standard"], ["easy", "Wide letters (Verdana)"], ["atkinson", "Atkinson Hyperlegible (made for low vision)"]],
  "display.spacing": [["standard", "Standard"], ["wide", "Wider"], ["widest", "Widest"]],
};
const DISPLAY_KEYS = Object.keys(DEFAULTS).filter((key) => key.startsWith("display."));

// A saved value we don't recognise falls back to the default instead of breaking the page.
function choice(key) {
  const value = settings.get(key);
  return CHOICES[key].some(([id]) => id === value) ? value : DEFAULTS[key];
}

function textSize() {
  const size = choice("display.textSize");
  if (size !== "standard") return size;
  return settings.get("display.largeText") ? "large" : "standard"; // older saved choice
}

// Atkinson Hyperlegible comes from Google Fonts. It is only requested when someone picks it,
// and the page falls back to Verdana if it can't load.
function loadAtkinson() {
  if (document.getElementById("font-atkinson")) return;
  const link = document.createElement("link");
  link.id = "font-atkinson";
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap";
  document.head.append(link);
}

export function applyDisplaySettings() {
  const root = document.documentElement;
  root.dataset.contrast = settings.get("display.highContrast") ? "high" : "standard";
  root.dataset.textSize = textSize();
  const theme = choice("display.theme");
  if (theme === "auto") delete root.dataset.theme;
  else root.dataset.theme = theme;
  const font = choice("display.font");
  root.dataset.font = font;
  if (font === "atkinson") loadAtkinson();
  root.dataset.spacing = choice("display.spacing");
  root.dataset.bold = settings.get("display.bold") ? "on" : "off";
  root.dataset.focus = settings.get("display.bigFocus") ? "big" : "standard";
}

export function appearanceSettings() {
  const syncs = [];
  const status = h("p", { class: "muted", role: "status" });

  const toggle = (key, label) => {
    const input = h("input", {
      type: "checkbox",
      checked: settings.get(key),
      onchange: (event) => {
        settings.set(key, event.target.checked);
        applyDisplaySettings();
      },
    });
    syncs.push(() => { input.checked = settings.get(key); });
    return h("label", { class: "setting-toggle" }, input, h("span", {}, label));
  };

  const select = (key, label, current = () => choice(key), save = (value) => settings.set(key, value)) => {
    const control = h("select", {
      onchange: (event) => {
        save(event.target.value);
        applyDisplaySettings();
      },
    }, ...CHOICES[key].map(([value, text]) => h("option", { value }, text)));
    const sync = () => { control.value = current(); };
    sync();
    syncs.push(sync);
    return h("label", {}, h("span", {}, label), control);
  };

  const reset = h("button", {
    type: "button",
    onclick: () => {
      for (const key of DISPLAY_KEYS) settings.set(key, DEFAULTS[key]);
      applyDisplaySettings();
      for (const sync of syncs) sync();
      status.textContent = "Display settings reset to the defaults.";
    },
  }, "Reset display settings");

  return h("div", {},
    h("fieldset", { class: "settings-group" },
      h("legend", {}, "Color and contrast"),
      select("display.theme", "Color theme"),
      toggle("display.highContrast", "Use high contrast colors"),
      toggle("display.bigFocus", "Use a thicker focus outline")),
    h("fieldset", { class: "settings-group" },
      h("legend", {}, "Text"),
      select("display.textSize", "Text size", textSize, (value) => {
        settings.set("display.textSize", value);
        settings.set("display.largeText", value !== "standard");
      }),
      select("display.font", "Font"),
      select("display.spacing", "Spacing between letters, words and lines"),
      toggle("display.bold", "Use bold text")),
    reset,
    status);
}