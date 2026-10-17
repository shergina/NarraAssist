// Owner: Person 3. Short, distinct alerts for listener events.
import { settings } from "./settings.js";

let ctx;

function play(tones) {
  ctx ??= new AudioContext();
  const schedule = () => {
    for (const { from, to, duration, start = 0, type = "sine", volume = 0.12 } of tones) {
      const at = ctx.currentTime + start;
      const oscillator = ctx.createOscillator();
      const envelope = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(from, at);
      oscillator.frequency.exponentialRampToValueAtTime(to, at + duration);
      envelope.gain.setValueAtTime(volume, at);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      oscillator.connect(envelope).connect(ctx.destination);
      oscillator.start(at);
      oscillator.stop(at + duration);
    }
  };

  if (ctx.state === "suspended") {
    ctx.resume().then(schedule).catch((err) => console.warn("Earcon playback failed:", err.message));
  } else {
    schedule();
  }
}

export const earcons = {
  slideChanged: () => settings.get("sound.slideChanged") && play([
    { from: 190, to: 150, duration: 0.07, type: "triangle", volume: 0.16 },
    { from: 145, to: 115, duration: 0.09, start: 0.11, type: "triangle", volume: 0.12 },
  ]),
  presenterQuiet: () => settings.get("sound.presenterQuiet") && play([
    { from: 680, to: 340, duration: 0.36, volume: 0.1 },
  ]),
  caughtUp: () => settings.get("sound.caughtUp") && play([
    { from: 440, to: 660, duration: 0.14, volume: 0.1 },
    { from: 660, to: 990, duration: 0.18, start: 0.16, volume: 0.1 },
  ]),
  attention: () => play([
    { from: 880, to: 880, duration: 0.08, volume: 0.1 },
    { from: 880, to: 880, duration: 0.08, start: 0.16, volume: 0.1 },
  ]),
};
