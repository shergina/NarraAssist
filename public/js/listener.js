// Owner: Person 3. Wires the listener page together and decides what the listener hears.
// Rules: docs/ARCHITECTURE.md, "What the listener hears".
import { $, api, h, roomCode, slideLabel } from "./common.js";
import { connectSocket, STATUS_TEXT } from "./socket.js";
import { startCapture, watchSlides } from "./capture.js";
import { MeetingAudio } from "./audio-engine.js";
import { parseZoomLink, joinAsHelper, fakeHelper } from "./zoom-helper.js";
import { earcons } from "./earcons.js";
import { applyDisplaySettings, appearanceSettings, settings } from "./settings.js";
import { Speaker, announce } from "./speech.js";

applyDisplaySettings();
$("#display-settings").replaceChildren(
  h("p", { class: "muted" }, "These preferences are saved in this browser."),
  appearanceSettings(),
);

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
  manualDescriptionEnd: false,
  waiting: [], // words held back while a description plays
  speakers: [], // { name, at } not yet announced
  speakerHistory: [], // { name, at } used to answer "who is speaking" during catch-up
  lastSpeaker: null,
  lastAlert: "",
};

$("#room").textContent = room || "none";
const socket = connectSocket(room, "listener", {
  onMessage,
  onStatus: (s) => {
    const text = STATUS_TEXT[s] || s;
    $("#conn").textContent = text;
    say(text, { assertive: s === "unknown-room" });
  },
});

// ---------- what the listener hears ----------

// Nothing speaks over a description: words wait until it ends.
function say(text, options = {}) {
  if (!text) return;
  state.lastAlert = text;
  if (state.describing) state.waiting.push({ text, options });
  else announce(text, options);
}

function flushWaiting(prefix = "") {
  const queued = state.waiting.splice(0);
  const words = [prefix, ...queued.map(({ text }) => text)].filter(Boolean);
  if (words.length) announce(words.join(" "), { assertive: queued.some(({ options }) => options.assertive) });
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
      else if (msg.deck.status === "error") say(`Couldn't read the slides: ${msg.deck.error}`, { assertive: true });
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

async function onLocalSlideChange({ at, frame }) {
  earcons.slideChanged();
  try {
    await api(`/api/rooms/${room}/frame`, {
      method: "POST",
      body: frame,
      headers: { "Content-Type": "image/jpeg", "X-Captured-At": String(at) },
    });
  } catch (err) {
    console.warn("Frame check failed:", err.message);
    say("Couldn't send the slide for description. Check your connection and try again.", { assertive: true });
  }
}

// Speaker names: only while hearing the speaker, timed against what is actually playing.
function onSpeaker({ name, at }) {
  if (!name || !Number.isFinite(at)) return;
  const entry = { name, at };
  state.speakerHistory.push(entry);
  state.speakerHistory.sort((a, b) => a.at - b.at);
  const cutoff = Date.now() - 60 * 60 * 1000;
  while (state.speakerHistory.length > 1 && state.speakerHistory[1].at < cutoff) state.speakerHistory.shift();
  if (settings.get("announce.speaker")) {
    state.speakers.push(entry);
    state.speakers.sort((a, b) => a.at - b.at);
  }
}

function speakerAtPlaybackTime() {
  const heardUpTo = state.audio ? state.audio.meetingTime : Date.now();
  for (let i = state.speakerHistory.length - 1; i >= 0; i -= 1) {
    if (state.speakerHistory[i].at <= heardUpTo) return state.speakerHistory[i].name;
  }
  return null;
}

setInterval(() => {
  if (!settings.get("announce.speaker")) {
    state.speakers.length = 0;
    return;
  }
  if (state.describing || !state.speakers.length) return;
  const heardUpTo = state.audio ? state.audio.meetingTime : Date.now();
  const names = [];
  while (state.speakers.length && state.speakers[0].at <= heardUpTo) {
    const { name } = state.speakers.shift();
    if (name !== state.lastSpeaker) {
      state.lastSpeaker = name;
      names.push(name);
    }
  }
  if (names.length) say(names.join(". "));
}, 250);

// ---------- meeting connection ----------

function wireAudio(audio) {
  state.audio = audio;
  audio.addEventListener("mode", (event) => {
    renderMode();
    if (event.detail === "catchup") state.waiting.push({ text: "Catching up to live.", options: {} });
  });
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
    return say("Sharing was cancelled. Press Connect to try again.", { assertive: true });
  }
  const audio = new MeetingAudio(ctx, state.capture.stream, { maxRate: settings.get("catchup.maxRate") });
  wireAudio(audio);
  await audio.streamPcm((chunk) => socket.sendBinary(chunk));
  state.stopSlides = watchSlides(state.capture.video, { onChange: onLocalSlideChange });
  state.capture.stream.getVideoTracks()[0].addEventListener("ended", disconnect);
  $("#connect").textContent = "Disconnect";
  say("Connected to the meeting.");
});

function disconnect() {
  state.stopSlides?.();
  state.capture?.stream.getTracks().forEach((t) => t.stop());
  state.audio?.stop();
  Object.assign(state, { capture: null, audio: null, stopSlides: null });
  $("#connect").textContent = "Connect to Zoom tab";
  $("#mode").textContent = "Not connected to Zoom yet.";
  say("Disconnected from the meeting.");
}

$("#zoom").addEventListener("submit", async (e) => {
  e.preventDefault();
  const meeting = parseZoomLink($("#zoom-link").value);
  if (!meeting) return say("That doesn't look like a Zoom link or meeting ID.", { assertive: true });
  try {
    state.helper = await joinAsHelper({ ...meeting, container: $("#zoom-container") });
    state.helper.addEventListener("speaker", (ev) => onSpeaker(ev.detail));
    say("Speaker names are on.");
  } catch (err) {
    say(err.message, { assertive: true });
  }
});

// ---------- describe, catch up, go live ----------

function slideSpeech(slide) {
  return [`${slideLabel(slide)}.`, slide.overview || slide.text].filter(Boolean).join(" ");
}

function describeSlide(slide = state.slide) {
  if (!slide) return say("No slide yet.");
  speaker.cancel();
  state.describing = true;
  state.manualDescriptionEnd = false;
  state.audio?.hold();
  state.manualDescriptionEnd = !speaker.speak(slideSpeech(slide), {
    onEnd: () => state.describing && stopDescribing(),
  });
  renderMode();
}

function toggleDescribe() {
  if (state.describing) return stopDescribing();
  describeSlide();
}

function stopDescribing() {
  state.describing = false;
  state.manualDescriptionEnd = false;
  speaker.cancel();
  state.audio?.catchUp();
  renderMode();
  flushWaiting();
}

function skipToLive() {
  state.describing = false;
  state.manualDescriptionEnd = false;
  speaker.cancel();
  state.audio?.skipToLive();
  renderMode();
  flushWaiting("Back to live.");
}

function requestDescription(note = "") {
  socket.send({ type: "request-description", note });
}

function renderMode() {
  const audio = state.audio;
  $("#screen-reader-help").hidden = !state.manualDescriptionEnd;
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
  ["KeyA", "Repeat the last alert", () => say(state.lastAlert || "No alerts yet.")],
  ["KeyW", "Say who is speaking", () => {
    const name = speakerAtPlaybackTime();
    say(name ? `${name} is speaking.` : "No speaker yet.");
  }],
  ["KeyS", "Say the current slide", () => say(slideLabel(state.slide))],
  ["KeyQ", "Ask a question about the slides", () => $("#question").focus()],
  ["KeyH", "Hear all shortcuts", () => say(SHORTCUTS.map(([code, label]) => `Alt Shift ${code.slice(3)}: ${label}.`).join(" "))],
];

$("#shortcuts").replaceChildren(...SHORTCUTS.map(([code, label]) => h("li", {}, h("kbd", {}, `Alt+Shift+${code.slice(3)}`), ` ${label}`)));

document.addEventListener("keydown", (e) => {
  if (!e.altKey || !e.shiftKey) return;
  if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable='true']")) return;
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

const SETTING_GROUPS = [
  {
    label: "Live slide explainer",
    keys: ["sound.slideChanged", "announce.slideTitle"],
  },
  {
    label: "Meeting alerts",
    keys: ["sound.presenterQuiet", "sound.caughtUp", "announce.speaker"],
  },
];

function renderSettings() {
  const groups = SETTING_GROUPS.map(({ label, keys }) =>
    h("fieldset", { class: "settings-group" },
      h("legend", {}, label),
      ...keys.map((key) =>
        h("label", { class: "setting-toggle" },
          h("input", {
            type: "checkbox",
            checked: settings.get(key),
            onchange: (e) => settings.set(key, e.target.checked),
          }),
          h("span", {}, SETTING_LABELS[key])),
      )),
  );
  const select = (key, label, options) =>
    h("label", {}, label,
      h("select", {
        onchange: (e) => {
          const value = key === "speech.mode" ? e.target.value : Number(e.target.value);
          settings.set(key, value);
          if (key === "catchup.maxRate") state.audio?.setMaxRate(value);
        },
      },
        options.map(([value, text]) => h("option", { value, selected: String(settings.get(key)) === String(value) }, text))));
  $("#settings").replaceChildren(
    ...groups,
    h("fieldset", { class: "settings-group" },
      h("legend", {}, "Speech and catch-up"),
      h("div", { class: "settings-options" },
        select("speech.mode", "Read descriptions with", [["voice", "Built-in voice"], ["screen-reader", "My screen reader"]]),
        select("voice.rate", "Voice speed", [[1, "1x"], [1.2, "1.2x"], [1.5, "1.5x"], [2, "2x"]]),
        select("catchup.maxRate", "Fastest catch-up speed", [[1.5, "1.5x"], [2, "2x"], [2.5, "2.5x"]]))),
  );
}
renderSettings();

const settingsDialog = $("#settings-dialog");
$("#open-settings").addEventListener("click", () => settingsDialog.showModal());
$("#close-settings").addEventListener("click", () => settingsDialog.close());

// ---------- slides and questions ----------

function slideBlock(slide, headingTag) {
  return h("article", {},
    h(headingTag, {}, slideLabel(slide)),
    slide.text && h("p", { class: "pre" }, slide.text),
    slide.visuals && h("p", {}, h("strong", {}, "Visuals: "), slide.visuals),
    h("button", { onclick: () => describeSlide(slide) }, "Read overview aloud"));
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
  const answer = h("p", {}, "Thinking…");
  $("#answers").prepend(h("div", { class: "card" }, h("p", {}, h("strong", {}, "You asked: "), question), answer));
  $("#question").value = "";
  try {
    answer.textContent = (await api(`/api/rooms/${room}/ask`, { method: "POST", json: { question } })).answer;
    say(`Answer: ${answer.textContent}`);
  } catch (err) {
    answer.textContent = `Sorry, that failed: ${err.message}`;
    say(answer.textContent, { assertive: true });
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
  if (state.audio) return say("Already connected.");
  wireAudio(new MeetingAudio(new AudioContext(), new MediaStream(), { maxRate: settings.get("catchup.maxRate") }));
  say("Simulated meeting connected.");
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
