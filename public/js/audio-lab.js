// Owner: Person 2. Drives capture.js and audio-engine.js on the audio lab page.
import { $, h } from "./common.js";
import { startCapture, watchSlides } from "./capture.js";
import { MeetingAudio } from "./audio-engine.js";

const PCM_RATE = 16000;
const PCM_KEEP = PCM_RATE * 10; // samples kept for the WAV download

const lab = {
  ctx: null,
  capture: null,
  audio: null,
  stopSlides: null,
  pcm: [], // recent Int16Array chunks
  pcmSamples: 0,
  pcmTotal: 0,
  pcmStartedAt: 0,
  slideCount: 0,
  frameUrl: null,
  catchUpAt: 0,
  testTimer: null,
};

const time = (ms) => new Date(ms).toLocaleTimeString([], { hour12: false }) + "." + String(Math.floor((ms % 1000) / 100));
const db = (rms) => Math.max(-60, 20 * Math.log10(rms || 1e-6));

function log(text) {
  const box = $("#log");
  box.append(h("p", {}, `${time(Date.now())}  ${text}`));
  box.scrollTop = box.scrollHeight;
}

const RUN_BUTTONS = ["hold", "catchup", "live", "test", "wav"];
const SIM_BUTTONS = ["next-slide", "go-quiet"];

$("#capture").addEventListener("click", () => {
  if (lab.capture) return stopAll("Stopped.");
  begin(() => startCapture(), "Stop capture");
});
$("#simulate").addEventListener("click", () => {
  if (lab.capture) return stopAll("Stopped.");
  begin((ctx) => simulatedMeeting(ctx), "Stop simulation");
});
$("#file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (lab.capture) stopAll("Stopped.");
  begin((ctx) => simulatedMeeting(ctx, file), "Stop simulation");
});

// Starts a source and wires it to the engine and the slide watcher, the same way listener.js does.
async function begin(open, stopLabel) {
  lab.ctx = new AudioContext(); // created during the click so Chrome allows sound
  try {
    lab.capture = await open(lab.ctx);
  } catch (err) {
    lab.ctx.close();
    lab.ctx = null;
    return log(`Not started: ${err.message}`);
  }
  const { stream, video } = lab.capture;
  const audioTracks = stream.getAudioTracks();
  const name = lab.capture.label || `"${stream.getVideoTracks()[0].label}"`;
  $("#source").textContent = audioTracks.length
    ? `Playing ${name} with audio.`
    : `Capturing ${name} with NO audio. Share again and turn on "Also share tab audio".`;
  if (!lab.capture.sim) log(audioTracks.length ? `Audio track settings: ${JSON.stringify(audioTracks[0].getSettings())}` : "No audio track.");

  const audio = new MeetingAudio(lab.ctx, stream, { maxRate: Number($("#rate").value) });
  lab.audio = audio;
  audio.setSilenceThreshold(10 ** (Number($("#threshold").value) / 20));
  audio.addEventListener("mode", (e) => log(`mode: ${e.detail}`));
  audio.addEventListener("caught-up", () => {
    log(`caught-up${lab.catchUpAt ? ` after ${((performance.now() - lab.catchUpAt) / 1000).toFixed(1)} s of catch-up, ${audio.stats.skipped.toFixed(1)} s of pauses skipped` : ""}`);
    lab.catchUpAt = 0;
  });
  audio.addEventListener("presenter-quiet", () => log("presenter-quiet"));
  await audio.streamPcm(onPcm);

  lab.stopSlides = watchSlides(video, { onChange: onSlide, onTick: onSlideTick });
  $("#slides").textContent = "Watching. The first screen is reported once it holds still.";
  stream.getVideoTracks()[0].addEventListener("ended", () => stopAll("The shared tab stopped."));
  $(lab.capture.sim ? "#simulate" : "#capture").textContent = stopLabel;
  for (const id of RUN_BUTTONS) $(`#${id}`).disabled = false;
  for (const id of SIM_BUTTONS) $(`#${id}`).disabled = !lab.capture.sim;
  log(`${lab.capture.sim ? "Simulation" : "Capture"} started.`);
}

function stopAll(why) {
  clearTimeout(lab.testTimer);
  lab.stopSlides?.();
  lab.audio?.stop();
  lab.capture?.stop?.();
  lab.capture?.stream.getTracks().forEach((t) => t.stop());
  lab.ctx?.close();
  Object.assign(lab, { ctx: null, capture: null, audio: null, stopSlides: null });
  $("#capture").textContent = "Capture a tab";
  $("#simulate").textContent = "Simulated meeting";
  $("#source").textContent = "Nothing captured.";
  $("#slides").textContent = "Not watching.";
  $("#sim-screen").hidden = true;
  for (const id of [...RUN_BUTTONS, ...SIM_BUTTONS]) $(`#${id}`).disabled = true;
  log(why);
}

// ---------- simulated meeting ----------
// A made-up presenter and shared screen, built in this page, so every feature can be tried with no Zoom.
// The voice is fake vowels in phrases: short pauses (long ones get shortened in catch-up) and a 2.5 s
// pause every eighth phrase (fires presenter-quiet while held). The screen is a slide on a dark background,
// a column of camera tiles on the right with one person always moving (must be ignored and cropped off),
// and a static toolbar at the bottom.

const SIM_SLIDES = [
  { title: "Welcome", lines: ["Today: quarterly results", "Questions at the end"] },
  { title: "Q3 revenue", chart: [3, 5, 4, 8] },
  { title: "What changed", lines: ["New pricing in July", "Two new regions", "Support hours doubled"] },
  { title: "Next steps", lines: ["Hire two engineers", "Launch in Canada"] },
];
const VOWELS = [[800, 1200], [400, 2000], [300, 2300], [500, 900], [350, 800]];

async function simulatedMeeting(ctx, file) {
  const canvas = $("#sim-screen");
  canvas.hidden = false;
  const g = canvas.getContext("2d");
  const sim = { slide: 0, timers: [], stopVoice: () => {} };
  const dest = ctx.createMediaStreamDestination();

  let goQuiet;
  if (file) {
    const el = new Audio(URL.createObjectURL(file));
    el.loop = true;
    ctx.createMediaElementSource(el).connect(dest); // into the stream only, never straight to the speakers
    await el.play();
    sim.stopVoice = () => {
      el.pause();
      URL.revokeObjectURL(el.src);
    };
    goQuiet = () => {
      el.pause();
      sim.timers.push(setTimeout(() => el.play(), 4000));
    };
  } else {
    goQuiet = startVoice(ctx, dest, sim);
  }

  const draw = () => {
    const t = performance.now() / 1000;
    g.fillStyle = "#1f1f1f";
    g.fillRect(0, 0, 1280, 720);
    // the shared slide
    g.fillStyle = "#ffffff";
    g.fillRect(20, 80, 960, 540);
    const s = SIM_SLIDES[sim.slide % SIM_SLIDES.length];
    g.fillStyle = "#15304f";
    g.font = "bold 56px sans-serif";
    g.fillText(s.title, 70, 180);
    g.font = "36px sans-serif";
    (s.lines || []).forEach((line, i) => g.fillText(`• ${line}`, 90, 270 + i * 64));
    (s.chart || []).forEach((v, i) => {
      g.fillStyle = "#2f6fb3";
      g.fillRect(140 + i * 190, 580 - v * 40, 120, v * 40);
    });
    g.fillStyle = "#666666";
    g.font = "24px sans-serif";
    g.fillText(`${(sim.slide % SIM_SLIDES.length) + 1} / ${SIM_SLIDES.length}`, 890, 600);
    // camera tiles; the top one is a person who never sits still
    for (let i = 0; i < 3; i++) {
      g.fillStyle = "#333333";
      g.fillRect(1010, 80 + i * 180, 250, 170);
    }
    g.fillStyle = "#c98f5f";
    g.beginPath();
    g.arc(1135 + Math.sin(t * 1.7) * 45, 160 + Math.cos(t * 2.3) * 25, 45, 0, 2 * Math.PI);
    g.fill();
    // toolbar
    g.fillStyle = "#2b2b2b";
    g.fillRect(0, 660, 1280, 60);
    g.fillStyle = "#bbbbbb";
    g.fillText("Mute     Video     Participants     Share     Chat", 380, 698);
  };
  draw();
  sim.timers.push(setInterval(draw, 100));

  const stream = new MediaStream([...canvas.captureStream(10).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  return {
    stream,
    video,
    sim: true,
    label: file ? `the simulated meeting, voice from "${file.name}"` : "the simulated meeting",
    nextSlide: () => sim.slide++,
    goQuiet,
    stop: () => {
      sim.timers.forEach((id) => (clearInterval(id), clearTimeout(id)));
      sim.stopVoice();
      canvas.hidden = true;
    },
  };
}

// Fake speech: a buzzing voice through two vowel filters, shaped into syllables and phrases.
// Returns a function that makes the presenter go quiet for 4 s.
function startVoice(ctx, dest, sim) {
  const voice = ctx.createOscillator();
  voice.type = "sawtooth";
  voice.frequency.value = 140;
  const f1 = ctx.createBiquadFilter();
  const f2 = ctx.createBiquadFilter();
  f1.type = f2.type = "bandpass";
  f1.Q.value = 6;
  f2.Q.value = 8;
  const f2Level = ctx.createGain();
  f2Level.gain.value = 0.5;
  const amp = ctx.createGain();
  amp.gain.value = 0;
  voice.connect(f1).connect(amp);
  voice.connect(f2).connect(f2Level).connect(amp);
  amp.connect(dest);
  voice.start();

  let next = ctx.currentTime + 0.3;
  let phrases = 0;
  const schedule = () => {
    while (next < ctx.currentTime + 1) {
      let at = next;
      const syllables = 3 + Math.floor(Math.random() * 8);
      for (let i = 0; i < syllables; i++) {
        const length = 0.12 + Math.random() * 0.14;
        const [a, b] = VOWELS[Math.floor(Math.random() * VOWELS.length)];
        f1.frequency.setTargetAtTime(a, at, 0.02);
        f2.frequency.setTargetAtTime(b, at, 0.02);
        voice.frequency.setTargetAtTime(120 + Math.random() * 60, at, 0.05);
        amp.gain.setTargetAtTime(1.5, at, 0.02);
        amp.gain.setTargetAtTime(0.3, at + length * 0.7, 0.03);
        at += length;
      }
      amp.gain.setTargetAtTime(0, at, 0.03);
      phrases++;
      next = at + (phrases % 8 === 0 ? 2.5 : 0.15 + Math.random() * 0.9);
    }
  };
  schedule();
  sim.timers.push(setInterval(schedule, 250));
  sim.stopVoice = () => voice.stop();
  return () => {
    next = Math.max(next, ctx.currentTime) + 4;
  };
}

$("#next-slide").addEventListener("click", () => {
  lab.capture?.nextSlide?.();
  log("Simulated presenter moved to the next slide.");
});
$("#go-quiet").addEventListener("click", () => {
  lab.capture?.goQuiet?.();
  log("Simulated presenter goes quiet for 4 s (presenter-quiet fires only while held or catching up).");
});

function onPcm(buffer) {
  const chunk = new Int16Array(buffer);
  if (!lab.pcmStartedAt) lab.pcmStartedAt = performance.now();
  lab.pcm.push(chunk);
  lab.pcmSamples += chunk.length;
  lab.pcmTotal += chunk.length;
  while (lab.pcmSamples - lab.pcm[0].length >= PCM_KEEP) lab.pcmSamples -= lab.pcm.shift().length;
}

function onSlide({ at, frame }) {
  lab.slideCount++;
  $("#slides").textContent = `Slide change ${lab.slideCount} at ${time(at)}, frame ${(frame.size / 1024).toFixed(0)} kB.`;
  if (lab.frameUrl) URL.revokeObjectURL(lab.frameUrl);
  lab.frameUrl = URL.createObjectURL(frame);
  const img = $("#frame");
  img.src = lab.frameUrl;
  img.hidden = false;
  log(`slide change ${lab.slideCount}`);
}

function onSlideTick({ box, watched, changed, moving, settling }) {
  $("#crop").textContent = `Crop ${box.width}×${box.height} at ${box.x},${box.y}. Watching ${watched} cells: ${changed} differ from the last slide, ${moving} still moving${settling ? ", settling" : ""}.`;
}

$("#hold").addEventListener("click", () => lab.audio?.hold());
$("#catchup").addEventListener("click", () => {
  if (lab.audio?.mode !== "held") return log("Catch up only works while held.");
  lab.catchUpAt = performance.now();
  lab.audio.catchUp();
});
$("#live").addEventListener("click", () => {
  clearTimeout(lab.testTimer);
  lab.audio?.skipToLive();
});
$("#test").addEventListener("click", () => {
  if (!lab.audio) return;
  clearTimeout(lab.testTimer);
  lab.audio.skipToLive();
  lab.audio.hold();
  log("Test: holding for 30 s.");
  lab.testTimer = setTimeout(() => {
    if (lab.audio?.mode !== "held") return;
    lab.catchUpAt = performance.now();
    lab.audio.catchUp();
  }, 30_000);
});

$("#rate").addEventListener("input", (e) => {
  const rate = Number(e.target.value);
  $("#rate-out").textContent = `${rate.toFixed(2)}x`;
  lab.audio?.setMaxRate(rate);
});
$("#threshold").addEventListener("input", (e) => {
  const value = Number(e.target.value);
  $("#threshold-out").textContent = `${value} dB`;
  lab.audio?.setSilenceThreshold(10 ** (value / 20));
});

$("#wav").addEventListener("click", () => {
  if (!lab.pcmSamples) return log("No PCM received yet.");
  const pcm = new Int16Array(lab.pcmSamples);
  let at = 0;
  for (const chunk of lab.pcm) {
    pcm.set(chunk, at);
    at += chunk.length;
  }
  const head = new DataView(new ArrayBuffer(44));
  const text = (offset, s) => [...s].forEach((ch, i) => head.setUint8(offset + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  head.setUint32(4, 36 + pcm.byteLength, true);
  text(8, "WAVEfmt ");
  head.setUint32(16, 16, true);
  head.setUint16(20, 1, true);
  head.setUint16(22, 1, true);
  head.setUint32(24, PCM_RATE, true);
  head.setUint32(28, PCM_RATE * 2, true);
  head.setUint16(32, 2, true);
  head.setUint16(34, 16, true);
  text(36, "data");
  head.setUint32(40, pcm.byteLength, true);
  const url = URL.createObjectURL(new Blob([head, pcm], { type: "audio/wav" }));
  const a = h("a", { href: url, download: "audio-lab-16khz.wav" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.addEventListener("keydown", (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey || e.target.matches("input, textarea, select")) return;
  const button = { h: "#hold", u: "#catchup", l: "#live", t: "#test", n: "#next-slide", q: "#go-quiet" }[e.key.toLowerCase()];
  if (!button || $(button).disabled) return;
  e.preventDefault();
  $(button).click();
});

setInterval(() => {
  const audio = lab.audio;
  if (!audio) return;
  const s = audio.stats;
  $("#r-mode").textContent = s.running ? audio.mode : `${audio.mode} (engine not running)`;
  $("#r-behind").textContent = audio.secondsBehind.toFixed(1);
  const mt = audio.meetingTime;
  $("#r-meeting").textContent = audio.mode === "live" ? `${time(mt)} (live)` : `${time(mt)}, spoken ${((Date.now() - mt) / 1000).toFixed(1)} s ago`;
  $("#r-rate").textContent = `${s.rate.toFixed(2)}x`;
  $("#r-skipped").textContent = `${s.skipped.toFixed(1)} s`;
  $("#r-recorded").textContent = `${s.recorded.toFixed(1)} s`;
  $("#r-level").value = db(s.level);
  $("#r-level-text").textContent = `${db(s.level).toFixed(0)} dB`;
  $("#r-context").textContent = `${s.sampleRate} Hz, ${lab.ctx?.state}, output latency ${((lab.ctx?.outputLatency || lab.ctx?.baseLatency || 0) * 1000).toFixed(0)} ms`;
  if (lab.pcmTotal) {
    const secs = (performance.now() - lab.pcmStartedAt) / 1000;
    $("#pcm").textContent = `${(lab.pcmTotal / PCM_RATE).toFixed(1)} s of 16 kHz PCM received in ${secs.toFixed(1)} s (${(lab.pcmTotal / secs).toFixed(0)} samples per second).`;
  }
}, 200);
