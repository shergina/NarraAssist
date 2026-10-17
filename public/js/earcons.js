// Owner: Person 3. Placeholder tones. TODO(Person 3): the real knock, falling tone and rising sweep.
import { settings } from "./settings.js";

let ctx;
function tone(freq, to, dur, start = 0) {
  ctx ??= new AudioContext();
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  env.gain.setValueAtTime(0.25, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(env).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur);
}

export const earcons = {
  slideChanged: () => settings.get("sound.slideChanged") && tone(220, 160, 0.08),
  presenterQuiet: () => settings.get("sound.presenterQuiet") && tone(660, 300, 0.35),
  caughtUp: () => settings.get("sound.caughtUp") && (tone(440, 660, 0.14), tone(660, 990, 0.18, 0.16)),
  attention: () => (tone(880, 880, 0.1), tone(880, 880, 0.1, 0.18)),
};
