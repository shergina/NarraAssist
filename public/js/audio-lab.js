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

$("#capture").addEventListener("click", async () => {
  if (lab.capture) return stopAll("Stopped.");
  lab.ctx = new AudioContext(); // created during the click so Chrome allows sound
  try {
    lab.capture = await startCapture();
  } catch (err) {
    lab.ctx.close();
    return log(`Capture cancelled: ${err.message}`);
  }
  const { stream, video } = lab.capture;
  const audioTracks = stream.getAudioTracks();
  $("#source").textContent = audioTracks.length
    ? `Capturing "${stream.getVideoTracks()[0].label}" with audio.`
    : `Capturing "${stream.getVideoTracks()[0].label}" with NO audio. Share again and turn on "Also share tab audio".`;
  log(audioTracks.length ? `Audio track settings: ${JSON.stringify(audioTracks[0].getSettings())}` : "No audio track.");

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
  $("#slides").textContent = "Watching. No change yet.";
  stream.getVideoTracks()[0].addEventListener("ended", () => stopAll("The shared tab stopped."));
  $("#capture").textContent = "Stop capture";
  for (const id of ["hold", "catchup", "live", "test", "wav"]) $(`#${id}`).disabled = false;
  log("Capture started.");
});

function stopAll(why) {
  clearTimeout(lab.testTimer);
  lab.stopSlides?.();
  lab.audio?.stop();
  lab.capture?.stream.getTracks().forEach((t) => t.stop());
  lab.ctx?.close();
  Object.assign(lab, { ctx: null, capture: null, audio: null, stopSlides: null });
  $("#capture").textContent = "Capture a tab";
  $("#source").textContent = "Nothing captured.";
  $("#slides").textContent = "Not watching.";
  for (const id of ["hold", "catchup", "live", "test", "wav"]) $(`#${id}`).disabled = true;
  log(why);
}

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
  const button = { h: "#hold", u: "#catchup", l: "#live", t: "#test" }[e.key.toLowerCase()];
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
