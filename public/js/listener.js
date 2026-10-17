// Owner: Person 3. Wires the listener page together and decides what the listener hears.
// Rules: docs/ARCHITECTURE.md, "What the listener hears".
import { $, api, h, roomCode, slideLabel } from "./common.js";
import { connectSocket, STATUS_TEXT } from "./socket.js";
import { startCapture, watchSlides } from "./capture.js";
import { MeetingAudio } from "./audio-engine.js";
import { parseZoomLink, joinAsHelper, fakeHelper } from "./zoom-helper.js";
import { earcons } from "./earcons.js";
import { settings } from "./settings.js";
import { Speaker, announce } from "./speech.js";

const room = roomCode();
const speaker = new Speaker();
const state = {
  slide: null,
  slides: [],
  deck: null,
  summary: "",
  audio: null,
  capture: null,
  stopSlides: null,
  helper: null,
  describing: false,
  waiting: [], // words held back while a description plays
  speakers: [], // { name, at } not yet announced
  lastSpeaker: null,
  lastAlert: "",
};

$("#room").textContent = room || "none";
const socket = connectSocket(room, "listener", {
  onMessage,
  onStatus: (s) => ($("#conn").textContent = STATUS_TEXT[s] || s),
});

// ---------- what the listener hears ----------

// Nothing speaks over a description: words wait until it ends.
function say(text) {
  state.lastAlert = text;
  if (state.describing) state.waiting.push(text);
  else announce(text);
}

function flushWaiting() {
  const words = state.waiting.splice(0);
  if (words.length) announce(words.join(" "));
}

function onMessage(msg) {
  switch (msg.type) {
    case "state":
      Object.assign(state, { slide: msg.state.current, slides: msg.state.slides, deck: msg.state.deck, summary: msg.state.summary });
      $("#transcript").replaceChildren(...msg.state.transcript.map((t) => h("p", {}, t.text)));
      renderDeck();
      renderSlide();
      break;
    case "deck":
      state.deck = msg.deck;
      if (msg.slides) state.slides = msg.slides;
      if (msg.summary != null) state.summary = msg.summary;
      renderDeck();
      if (msg.deck.status === "ready") say(`Slides are ready: ${msg.deck.slideCount} slides.`);
      break;
    case "slide":
      state.slide = msg.slide;
      renderSlide();
      // The knock for screen changes already played locally. Presenter-driven changes knock here.
      if (msg.source === "presenter") {
        earcons.slideChanged();
        if (settings.get("announce.slideTitle")) say(`New slide. ${slideLabel(msg.slide)}`);
      }
      break;
    case "transcript":
      addTranscript(msg.entry.text);
      break;
    case "request-sent":
      say(msg.hasPresenter ? "Request sent to the presenter." : "Request saved. The presenter page isn't open yet.");
      break;
    case "presenter-response":
      say(msg.action === "accept" ? "The presenter is going to describe it now." : "The presenter can't describe it right now.");
      break;
  }
}

async function onLocalSlideChange({ frame }) {
  earcons.slideChanged();
  try {
    await api(`/api/rooms/${room}/frame`, { method: "POST", body: frame, headers: { "Content-Type": "image/jpeg" } });
  } catch (err) {
    console.warn("Frame check failed:", err.message);
  }
}

// Speaker names: only while hearing the speaker, timed against what is actually playing.
function onSpeaker({ name, at }) {
  if (settings.get("announce.speaker")) state.speakers.push({ name, at });
}

setInterval(() => {
  if (state.describing || !state.speakers.length) return;
  const heardUpTo = state.audio ? state.audio.meetingTime : Date.now();
  let due = null;
  while (state.speakers.length && state.speakers[0].at <= heardUpTo) due = state.speakers.shift();
  if (due && due.name !== state.lastSpeaker) {
    state.lastSpeaker = due.name;
    say(due.name);
  }
}, 250);

// ---------- meeting connection ----------

function wireAudio(audio) {
  state.audio = audio;
  audio.addEventListener("mode", renderMode);
  audio.addEventListener("caught-up", () => {
    earcons.caughtUp();
    say("Back to live.");
  });
  audio.addEventListener("presenter-quiet", () => {
    earcons.presenterQuiet();
    say("The presenter stopped talking.");
  });
  renderMode();
}

$("#connect").addEventListener("click", async () => {
  if (state.capture) return disconnect();
  const ctx = new AudioContext(); // created during the click so Chrome allows sound
  try {
    state.capture = await startCapture();
  } catch {
    ctx.close();
    return announce("Sharing was cancelled. Press Connect to try again.", { assertive: true });
  }
  const audio = new MeetingAudio(ctx, state.capture.stream, { maxRate: settings.get("catchup.maxRate") });
  wireAudio(audio);
  await audio.streamPcm((chunk) => socket.sendBinary(chunk));
  state.stopSlides = watchSlides(state.capture.video, { onChange: onLocalSlideChange });
  state.capture.stream.getVideoTracks()[0].addEventListener("ended", disconnect);
  $("#connect").textContent = "Disconnect";
  announce("Connected to the meeting.");
});

function disconnect() {
  state.stopSlides?.();
  state.capture?.stream.getTracks().forEach((t) => t.stop());
  state.audio?.stop();
  Object.assign(state, { capture: null, audio: null, stopSlides: null });
  $("#connect").textContent = "Connect to Zoom tab";
  $("#mode").textContent = "Not connected to Zoom yet.";
  announce("Disconnected from the meeting.");
}

$("#zoom").addEventListener("submit", async (e) => {
  e.preventDefault();
  const meeting = parseZoomLink($("#zoom-link").value);
  if (!meeting) return announce("That doesn't look like a Zoom link or meeting ID.", { assertive: true });
  try {
    state.helper = await joinAsHelper({ ...meeting, container: $("#zoom-container") });
    state.helper.addEventListener("speaker", (ev) => onSpeaker(ev.detail));
    announce("Speaker names are on.");
  } catch (err) {
    announce(err.message, { assertive: true });
  }
});

// ---------- describe, catch up, go live ----------

function slideSpeech(slide) {
  return [`${slideLabel(slide)}.`, slide.overview || slide.text].filter(Boolean).join(" ");
}

function toggleDescribe() {
  if (state.describing) return stopDescribing();
  if (!state.slide) return announce("No slide yet.");
  state.describing = true;
  state.audio?.hold();
  renderMode();
  speaker.speak(slideSpeech(state.slide), { onEnd: () => state.describing && stopDescribing() });
}

function stopDescribing() {
  state.describing = false;
  speaker.cancel();
  state.audio?.catchUp();
  renderMode();
  flushWaiting();
}

function skipToLive() {
  state.describing = false;
  speaker.cancel();
  state.audio?.skipToLive();
  renderMode();
  flushWaiting();
}

function requestDescription(note = "") {
  socket.send({ type: "request-description", note });
}

function renderMode() {
  const audio = state.audio;
  $("#describe").textContent = state.describing ? "Back to presenter" : "Describe slide";
  $("#live").disabled = !audio || audio.mode === "live";
  if (!audio) return;
  const behind = Math.round(audio.secondsBehind);
  $("#mode").textContent = {
    live: "Live: you are hearing the presenter.",
    held: `Paused for the description. ${behind} seconds behind.`,
    catchup: `Catching up. ${behind} seconds behind.`,
  }[audio.mode];
}
setInterval(() => state.audio && state.audio.mode !== "live" && renderMode(), 1000);

$("#describe").addEventListener("click", toggleDescribe);
$("#live").addEventListener("click", skipToLive);
$("#request").addEventListener("submit", (e) => {
  e.preventDefault();
  requestDescription($("#request-note").value.trim());
  $("#request-note").value = "";
});

// ---------- keyboard shortcuts (keep in sync with PRODUCT.md) ----------

const SHORTCUTS = [
  ["KeyD", "Describe the slide, or go back to the presenter", toggleDescribe],
  ["KeyL", "Skip straight to live", skipToLive],
  ["KeyR", "Ask the presenter to describe something", () => requestDescription()],
  ["KeyA", "Repeat the last alert", () => announce(state.lastAlert || "No alerts yet.")],
  ["KeyW", "Say who is speaking", () => announce(state.lastSpeaker ? `${state.lastSpeaker} is speaking.` : "No speaker yet.")],
  ["KeyS", "Say the current slide", () => announce(slideLabel(state.slide))],
  ["KeyQ", "Ask a question about the slides", () => $("#question").focus()],
  ["KeyH", "Hear all shortcuts", () => announce(SHORTCUTS.map(([code, label]) => `Alt Shift ${code.slice(3)}: ${label}.`).join(" "))],
];

$("#shortcuts").replaceChildren(...SHORTCUTS.map(([code, label]) => h("li", {}, h("kbd", {}, `Alt+Shift+${code.slice(3)}`), ` ${label}`)));

document.addEventListener("keydown", (e) => {
  if (!e.altKey || !e.shiftKey) return;
  const match = SHORTCUTS.find(([code]) => code === e.code);
  if (match) {
    e.preventDefault();
    match[2]();
  }
});

// ---------- settings ----------

const SETTING_LABELS = {
  "sound.slideChanged": "Sound when the slide changes",
  "sound.presenterQuiet": "Sound when the presenter stops talking",
  "sound.caughtUp": "Sound when caught up to live",
  "announce.speaker": "Announce who is speaking",
  "announce.slideTitle": "Announce slide titles",
};

function renderSettings() {
  const toggles = Object.entries(SETTING_LABELS).map(([key, label]) =>
    h("label", { class: "inline" },
      h("input", { type: "checkbox", checked: settings.get(key), onchange: (e) => settings.set(key, e.target.checked) }),
      label),
  );
  const select = (key, label, options) =>
    h("label", {}, label,
      h("select", { onchange: (e) => settings.set(key, isNaN(e.target.value) ? e.target.value : Number(e.target.value)) },
        options.map(([value, text]) => h("option", { value, selected: String(settings.get(key)) === String(value) }, text))));
  $("#settings").replaceChildren(
    ...toggles.map((t) => h("div", {}, t)),
    h("div", { class: "row" },
      select("speech.mode", "Read descriptions with", [["voice", "Built-in voice"], ["screen-reader", "My screen reader"]]),
      select("voice.rate", "Voice speed", [[1, "1x"], [1.2, "1.2x"], [1.5, "1.5x"], [2, "2x"]]),
      select("catchup.maxRate", "Fastest catch-up speed", [[1.5, "1.5x"], [2, "2x"], [2.5, "2.5x"]])),
  );
}
renderSettings();

// ---------- slides and questions ----------

function slideBlock(slide, headingTag) {
  return h("article", {},
    h(headingTag, {}, slideLabel(slide)),
    slide.text && h("p", { class: "pre" }, slide.text),
    slide.visuals && h("p", {}, h("strong", {}, "Visuals: "), slide.visuals),
    h("button", { onclick: () => speaker.speak(slideSpeech(slide)) }, "Read overview aloud"));
}

function renderSlide() {
  $("#current").replaceChildren(state.slide ? slideBlock(state.slide, "h3") : h("p", { class: "muted" }, "No slide yet."));
}

function renderDeck() {
  const d = state.deck;
  $("#deck-status").textContent = !d || d.status === "none"
    ? "No slides uploaded. That's fine: slides are described from the shared screen."
    : { processing: `Preparing ${d.fileName}…`, ready: `${d.fileName}: ${d.slideCount} slides.`, error: `Couldn't read the slides: ${d.error}` }[d.status];
  $("#summary").replaceChildren(...(state.summary ? [h("h3", {}, "Summary"), h("p", {}, state.summary)] : []));
  $("#slides").replaceChildren(...state.slides.map((s) => slideBlock(s, "h4")));
}

$("#ask").addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = $("#question").value.trim();
  if (!question) return;
  const answer = h("p", { "aria-live": "polite" }, "Thinking…");
  $("#answers").prepend(h("div", { class: "card" }, h("p", {}, h("strong", {}, "You asked: "), question), answer));
  $("#question").value = "";
  try {
    answer.textContent = (await api(`/api/rooms/${room}/ask`, { method: "POST", json: { question } })).answer;
  } catch (err) {
    answer.textContent = `Sorry, that failed: ${err.message}`;
  }
});

function addTranscript(text) {
  const box = $("#transcript");
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 20;
  box.append(h("p", {}, text));
  if (atBottom) box.scrollTop = box.scrollHeight;
}

// ---------- developer tools ----------

$("#dev-meeting").addEventListener("click", () => {
  if (state.audio) return announce("Already connected.");
  wireAudio(new MeetingAudio(new AudioContext(), new MediaStream(), { maxRate: settings.get("catchup.maxRate") }));
  announce("Simulated meeting connected.");
});
$("#dev-slide").addEventListener("click", () => onLocalSlideChange({ at: Date.now(), frame: new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" }) }));
$("#dev-speaker").addEventListener("click", () => {
  if (!state.helper) {
    state.helper = fakeHelper();
    state.helper.addEventListener("speaker", (ev) => onSpeaker(ev.detail));
  }
  const names = ["Priya Shah", "Marcus Lee", "Dr. Okafor"].filter((n) => n !== state.lastSpeaker);
  state.helper.emitSpeaker?.(names[Math.floor(Math.random() * names.length)]);
});
$("#dev-say").addEventListener("click", () => api(`/api/rooms/${room}/dev/transcript`, { method: "POST", json: { text: "As you can see here, the numbers went up a lot." } }));
$("#dev-quiet").addEventListener("click", () => state.audio?.dispatchEvent(new Event("presenter-quiet")));
