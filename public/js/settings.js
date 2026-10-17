// Owner: Person 3. Listener preferences, saved in this browser. Every sound and announcement defaults to on.
const DEFAULTS = {
  "sound.slideChanged": true,
  "sound.presenterQuiet": true,
  "sound.caughtUp": true,
  "announce.speaker": true,
  "announce.slideTitle": true,
  "voice.rate": 1.2,
  "catchup.maxRate": 2,
  "speech.mode": "voice", // "voice" | "screen-reader"
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
