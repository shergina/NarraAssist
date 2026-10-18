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
  pipWindow: null,
  pipControls: null,
  pipRequestId: 0,
  connecting: false,
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
      renderFloatingVideo();
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
      renderFloatingVideo();
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

function describeLabel() {
  return state.describing ? "Stop and catch up" : "Describe slide";
}

function renderFloatingVideo() {
  const button = $("#floating-video");
  const supported = Boolean(window.documentPictureInPicture?.requestWindow);
  const active = Boolean(state.pipWindow && !state.pipWindow.closed);
  button.disabled = !supported || (!state.capture && !active);
  button.setAttribute("aria-pressed", String(active));
  button.textContent = active ? "Close floating player" : "Open floating player";
  $("#floating-video-status").textContent = !supported
    ? "The floating player needs Chrome."
    : active
      ? "The floating player is open. It shows the Zoom video with Describe and the shortcuts, on top of other windows."
      : "The floating player shows the Zoom video with Describe and the shortcuts, on top of other windows.";
  if (state.pipControls) {
    state.pipControls.describe.disabled = !state.slide;
    state.pipControls.describe.textContent = describeLabel();
    state.pipControls.status.textContent = $("#mode").textContent;
  }
}

function closeFloatingVideo() {
  state.pipRequestId += 1;
  const pipWindow = state.pipWindow;
  state.pipWindow = null;
  state.pipControls = null;
  if (state.capture?.video) $("#capture-preview").replaceChildren(state.capture.video);
  pipWindow?.close();
  renderFloatingVideo();
}

function buildFloatingPlayer(pipWindow) {
  const pipDocument = pipWindow.document;
  pipDocument.head.replaceChildren();
  for (const stylesheet of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
    pipDocument.head.append(stylesheet.cloneNode(true));
  }
  const style = pipDocument.createElement("style");
  style.textContent = `
    body { min-width: 18rem; margin: 0; padding: .75rem; }
    .pip-player { display: grid; gap: .65rem; }
    .pip-player[hidden], .pip-settings[hidden] { display: none; }
    .pip-player h1 { margin: 0; font-size: 1.1rem; }
    .pip-video { width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: .5rem; }
    .pip-video video { width: 100%; height: 100%; object-fit: contain; }
    .pip-controls { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; }
    .pip-controls button { min-height: 2.75rem; }
    .pip-status { margin: 0; font-size: .95rem; }
    .pip-settings { max-height: 90vh; overflow: auto; margin: 0; }
    .pip-settings fieldset { margin: .75rem 0; padding: .5rem; }
    .pip-settings label { display: flex; flex-direction: row; align-items: center; gap: .5rem; }
    .pip-settings input[type="checkbox"] { width: 1.25rem; height: 1.25rem; }
    .pip-settings select { width: 100%; }
    .pip-settings h2 { font-size: 1rem; }
  `;
  pipDocument.head.append(style);
  pipDocument.documentElement.dataset.contrast = document.documentElement.dataset.contrast;
  pipDocument.documentElement.dataset.textSize = document.documentElement.dataset.textSize;

  const player = pipDocument.createElement("main");
  player.className = "pip-player";
  const heading = pipDocument.createElement("h1");
  heading.textContent = "NarraAssist meeting";
  const videoContainer = pipDocument.createElement("div");
  videoContainer.className = "pip-video";
  videoContainer.setAttribute("aria-label", "Shared Zoom tab video");
  const status = pipDocument.createElement("p");
  status.className = "pip-status";
  status.setAttribute("role", "status");
  const controls = pipDocument.createElement("div");
  controls.className = "pip-controls";
  const describe = pipDocument.createElement("button");
  describe.type = "button";
  describe.textContent = "Describe slide";
  describe.addEventListener("click", toggleDescribe);
  const settingsButton = pipDocument.createElement("button");
  settingsButton.type = "button";
  settingsButton.textContent = "Listener settings";
  const settingsPanel = pipDocument.createElement("section");
  settingsPanel.className = "pip-settings";
  settingsPanel.hidden = true;
  const showSettings = () => {
    const heading = pipDocument.createElement("h2");
    heading.textContent = "Listener settings";
    heading.tabIndex = -1;
    const back = pipDocument.createElement("button");
    back.type = "button";
    back.textContent = "Back to meeting controls";
    back.addEventListener("click", () => {
      settingsPanel.hidden = true;
      player.hidden = false;
      settingsButton.focus();
    });
    settingsPanel.replaceChildren(heading, back);

    const toggles = [
      ["sound.slideChanged", "Sound when the slide changes"],
      ["announce.slideTitle", "Announce slide titles"],
      ["sound.presenterQuiet", "Sound when the presenter stops talking"],
      ["sound.caughtUp", "Sound when caught up to live"],
      ["announce.speaker", "Announce who is speaking"],
      ["video.float", "Automatically open the floating player when connecting"],
    ];
    const toggleGroup = pipDocument.createElement("fieldset");
    const toggleLegend = pipDocument.createElement("legend");
    toggleLegend.textContent = "Alerts";
    toggleGroup.append(toggleLegend);
    for (const [key, labelText] of toggles) {
      const label = pipDocument.createElement("label");
      const input = pipDocument.createElement("input");
      input.type = "checkbox";
      input.checked = settings.get(key);
      input.addEventListener("change", () => settings.set(key, input.checked));
      label.append(input, pipDocument.createTextNode(labelText));
      toggleGroup.append(label);
    }
    settingsPanel.append(toggleGroup);

    const displayGroup = pipDocument.createElement("fieldset");
    const displayLegend = pipDocument.createElement("legend");
    displayLegend.textContent = "Display and text";
    displayGroup.append(displayLegend);
    for (const [key, labelText] of [
      ["display.highContrast", "Use high contrast colors"],
      ["display.largeText", "Use larger text"],
    ]) {
      const label = pipDocument.createElement("label");
      const input = pipDocument.createElement("input");
      input.type = "checkbox";
      input.checked = settings.get(key);
      input.addEventListener("change", () => {
        settings.set(key, input.checked);
        applyDisplaySettings();
        pipDocument.documentElement.dataset.contrast = document.documentElement.dataset.contrast;
        pipDocument.documentElement.dataset.textSize = document.documentElement.dataset.textSize;
      });
      label.append(input, pipDocument.createTextNode(labelText));
      displayGroup.append(label);
    }
    settingsPanel.append(displayGroup);

    const selectGroup = pipDocument.createElement("fieldset");
    const selectLegend = pipDocument.createElement("legend");
    selectLegend.textContent = "Speech and catch-up";
    selectGroup.append(selectLegend);
    const selects = [
      ["speech.mode", "Read descriptions with", [["voice", "Built-in voice"], ["screen-reader", "My screen reader"]]],
      ["voice.rate", "Voice speed", [[1, "1x"], [1.2, "1.2x"], [1.5, "1.5x"], [2, "2x"]]],
      ["catchup.maxRate", "Fastest catch-up speed", [[1.5, "1.5x"], [2, "2x"], [2.5, "2.5x"]]],
    ];
    for (const [key, labelText, options] of selects) {
      const label = pipDocument.createElement("label");
      const text = pipDocument.createElement("span");
      text.textContent = labelText;
      const select = pipDocument.createElement("select");
      for (const [value, optionText] of options) {
        const option = pipDocument.createElement("option");
        option.value = value;
        option.textContent = optionText;
        option.selected = String(settings.get(key)) === String(value);
        select.append(option);
      }
      select.addEventListener("change", () => {
        const value = key === "speech.mode" ? select.value : Number(select.value);
        settings.set(key, value);
        if (key === "catchup.maxRate") state.audio?.setMaxRate(value);
      });
      label.append(text, select);
      selectGroup.append(label);
    }
    settingsPanel.append(selectGroup);
    player.hidden = true;
    settingsPanel.hidden = false;
    pipDocument.body.replaceChildren(player, settingsPanel);
    heading.focus();
  };
  settingsButton.addEventListener("click", showSettings);
  controls.append(describe, settingsButton);
  player.append(heading, videoContainer, status, controls);
  pipDocument.body.replaceChildren(player, settingsPanel);
  pipDocument.addEventListener("keydown", (event) => {
    if (!event.altKey || !event.shiftKey) return;
    if (pipDocument.activeElement?.matches("input, textarea, select, [contenteditable='true']")) return;
    const shortcut = SHORTCUTS.find(([code]) => code === event.code);
    if (!shortcut) return;
    event.preventDefault();
    shortcut[2]();
  });

  state.pipWindow = pipWindow;
  state.pipControls = { videoContainer, status, describe, showSettings };
  if (state.capture?.video) videoContainer.append(state.capture.video);
  pipWindow.addEventListener("pagehide", () => {
    if (state.pipWindow !== pipWindow) return;
    state.pipWindow = null;
    state.pipControls = null;
    if (state.capture?.video) $("#capture-preview").replaceChildren(state.capture.video);
    renderFloatingVideo();
  });
  renderFloatingVideo();
}

async function openFloatingVideo() {
  const requestWindow = window.documentPictureInPicture?.requestWindow;
  if (!requestWindow) {
    renderFloatingVideo();
    say("Interactive floating player is not supported in this browser.", { assertive: true });
    return;
  }
  if (state.pipWindow) return;
  const requestId = ++state.pipRequestId;
  try {
    const pipWindow = await window.documentPictureInPicture.requestWindow({ width: 380, height: 430 });
    if (requestId !== state.pipRequestId) {
      pipWindow.close();
      return;
    }
    buildFloatingPlayer(pipWindow);
  } catch (err) {
    say(`Couldn't open the floating player: ${err.message}`, { assertive: true });
  }
}

function toggleFloatingVideo() {
  if (!state.capture && !state.pipWindow) {
    say("Connect to a Zoom tab before opening the floating player.");
    return;
  }
  if (state.pipWindow) closeFloatingVideo();
  else openFloatingVideo();
}

$("#connect").addEventListener("click", async () => {
  if (state.capture) return disconnect();
  if (state.connecting) return;
  state.connecting = true;
  $("#connect").disabled = true;
  $("#connect").textContent = "Connecting…";
  const floatingPlayerRequest = settings.get("video.float") ? openFloatingVideo() : null;
  const ctx = new AudioContext(); // created during the click so Chrome allows sound
  try {
    state.capture = await startCapture();
  } catch {
    state.connecting = false;
    ctx.close();
    closeFloatingVideo();
    $("#connect").disabled = false;
    $("#connect").textContent = "Connect to Zoom tab";
    return say("Sharing was cancelled. Press Connect to try again.", { assertive: true });
  }
  state.connecting = false;
  $("#connect").disabled = false;
  state.capture.video.setAttribute("aria-hidden", "true");
  state.capture.video.tabIndex = -1;
  if (state.pipControls) state.pipControls.videoContainer.append(state.capture.video);
  else $("#capture-preview").replaceChildren(state.capture.video);
  renderFloatingVideo();
  say("Connected. Live controls are available: Describe slide, Jump to live, and the floating player.");
  await floatingPlayerRequest;
  const audio = new MeetingAudio(ctx, state.capture.stream, { maxRate: settings.get("catchup.maxRate") });
  wireAudio(audio);
  await audio.streamPcm((chunk) => socket.sendBinary(chunk));
  state.stopSlides = watchSlides(state.capture.video, { onChange: onLocalSlideChange });
  state.capture.stream.getVideoTracks()[0].addEventListener("ended", disconnect);
  $("#connect").textContent = "Disconnect";
});

async function disconnect() {
  if (!state.capture) return;
  state.stopSlides?.();
  state.capture?.stream.getTracks().forEach((t) => t.stop());
  state.audio?.stop();
  closeFloatingVideo();
  $("#capture-preview").replaceChildren();
  Object.assign(state, { capture: null, audio: null, stopSlides: null });
  $("#connect").textContent = "Connect to Zoom tab";
  $("#mode").textContent = "Not connected to Zoom yet.";
  renderMode();
  say("Disconnected from the meeting. Live controls are hidden until you connect again.");
}

$("#zoom").addEventListener("submit", async (e) => {
  e.preventDefault();
  const meeting = parseZoomLink($("#zoom-link").value);
  if (!meeting) return say("That doesn't look like a Zoom link or meeting ID.", { assertive: true });
  try {
    state.helper = await joinAsHelper({ ...meeting, userName: $("#listener-name").value.trim() || undefined, container: $("#zoom-container") });
    state.helper.addEventListener("speaker", (ev) => onSpeaker(ev.detail));
    say("Speaker names are on.");
  } catch (err) {
    say(err.message, { assertive: true });
  }
});

// ---------- describe, catch up, go live ----------

// What is spoken for a slide: the title, then the full text (default) or the short summary, per the
// "describe.mode" setting. full: true forces the full text, for the "read the full slide" shortcut.
function slideSpeech(slide, { full = false } = {}) {
  const useSummary = !full && settings.get("describe.mode") === "summary" && slide.summary;
  const body = useSummary ? slide.summary : slide.overview || slide.text;
  return [`${slideLabel(slide)}.`, body].filter(Boolean).join(" ");
}

function describeSlide(slide = state.slide, { full = false } = {}) {
  if (!slide) return say("No slide yet.");
  speaker.cancel();
  state.describing = true;
  state.manualDescriptionEnd = false;
  state.audio?.hold();
  state.manualDescriptionEnd = !speaker.speak(slideSpeech(slide, { full }), {
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
  renderChatState();
  const audio = state.audio;
  $("#screen-reader-help").hidden = !state.manualDescriptionEnd;
  // Live controls exist only while connected. "Stop and catch up" plays what was missed; "Jump to live" drops it.
  const connected = Boolean(audio);
  $("#live-controls").hidden = !connected;
  $("#request").hidden = !connected;
  $("#setup-steps").hidden = connected && Boolean(state.capture);
  $("#describe").hidden = !connected;
  $("#describe").textContent = describeLabel();
  $("#live").hidden = !connected || audio.mode === "live";
  $("#floating-video").hidden = !connected;
  $("#floating-video-status").hidden = !connected;
  if (audio) {
    const behind = Math.round(audio.secondsBehind);
    $("#mode").textContent = {
      live: "Live: you are hearing the presenter.",
      held: `Paused for the description. ${behind} seconds behind.`,
      catchup: `Catching up. ${behind} seconds behind.`,
    }[audio.mode];
  }
  renderFloatingVideo();
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
  ["KeyD", "Describe the slide, or stop the description and catch up on what you missed", () => (state.audio ? toggleDescribe() : say("Connect to the Zoom tab first."))],
  ["KeyL", "Jump to live, skipping what you missed", () => (state.audio ? skipToLive() : say("Connect to the Zoom tab first."))],
  ["KeyR", "Ask the presenter to describe something", () => requestDescription()],
  ["KeyA", "Repeat the last alert", () => say(state.lastAlert || "No alerts yet.")],
  ["KeyW", "Say who is speaking", () => {
    const name = speakerAtPlaybackTime();
    say(name ? `${name} is speaking.` : "No speaker yet.");
  }],
  ["KeyS", "Say the current slide", () => say(slideLabel(state.slide))],
  ["KeyF", "Read the full slide text, even when summaries are on", () => describeSlide(state.slide, { full: true })],
  ["KeyQ", "Ask a question about the slides", () => $("#question").focus()],
  ["KeyV", "Open or close the floating player", () => (state.audio ? toggleFloatingVideo() : say("Connect to the Zoom tab first."))],
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
          const value = ["speech.mode", "describe.mode"].includes(key) ? e.target.value : Number(e.target.value);
          settings.set(key, value);
          if (key === "catchup.maxRate") state.audio?.setMaxRate(value);
        },
      },
        options.map(([value, text]) => h("option", { value, selected: String(settings.get(key)) === String(value) }, text))));
  $("#settings").replaceChildren(
    appearanceSettings(),
    ...groups,
    h("fieldset", { class: "settings-group" },
      h("legend", {}, "Speech and catch-up"),
      h("div", { class: "settings-options" },
        select("speech.mode", "Read descriptions with", [["voice", "Built-in voice"], ["screen-reader", "My screen reader"]]),
        select("describe.mode", "Describe slides as", [["full", "Full slide text"], ["summary", "Short summary"]]),
        select("voice.rate", "Voice speed", [[1, "1x"], [1.2, "1.2x"], [1.5, "1.5x"], [2, "2x"]]),
        select("catchup.maxRate", "Fastest catch-up speed", [[1.5, "1.5x"], [2, "2x"], [2.5, "2.5x"]]))),
    h("fieldset", { class: "settings-group" },
      h("legend", {}, "Picture-in-picture"),
      h("label", { class: "setting-toggle" },
        h("input", {
          type: "checkbox",
          checked: settings.get("video.float"),
          onchange: (e) => {
            settings.set("video.float", e.target.checked);
            if (e.target.checked && state.capture && !state.pipWindow) openFloatingVideo();
            else if (!e.target.checked && state.pipWindow) closeFloatingVideo();
          },
        }),
        h("span", {}, "Open the interactive floating player after connecting"))),
  );
}
renderSettings();

const settingsDialog = $("#settings-dialog");
$("#open-settings").addEventListener("click", () => settingsDialog.showModal());
$("#close-settings").addEventListener("click", () => settingsDialog.close());
$("#floating-video").addEventListener("click", toggleFloatingVideo);
renderFloatingVideo();

// ---------- slides and questions ----------

function slideBlock(slide, headingTag) {
  return h("article", {},
    h(headingTag, {}, slideLabel(slide)),
    slide.text && h("p", { class: "pre" }, slide.text),
    slide.visuals && h("p", {}, h("strong", {}, "Visuals: "), slide.visuals),
    h("button", { onclick: () => describeSlide(slide) }, "Read aloud"),
    h("button", { onclick: () => describeSlide(slide, { full: true }) }, "Read full text"));
}

function renderSlide() {
  $("#current").replaceChildren(state.slide ? slideBlock(state.slide, "h3") : h("p", { class: "muted" }, "No slide yet."));
}

function renderDeck() {
  const d = state.deck;
  $("#deck-status").textContent = !d || d.status === "none"
    ? "No slides uploaded. That's fine: slides are described from the shared screen."
    : { processing: `Preparing ${d.fileName}…`, ready: `${d.fileName}: ${d.slideCount} slides.`, error: `Couldn't read the slides: ${d.error}` }[d.status];
  const hasDeck = state.slides.length > 0;
  $("#deck-content").hidden = !hasDeck;
  if (!d || d.status === "none") $("#deck-status").textContent = "The presenter hasn't uploaded slides yet. The slides and questions appear here when they do.";
  $("#summary").replaceChildren(...(state.summary ? [h("h3", {}, "Summary"), h("p", {}, state.summary)] : []));
  $("#slides").replaceChildren(...state.slides.map((s) => slideBlock(s, "h4")));
  renderChatState();
}

// ---------- ask about the slides (before the meeting) ----------
// A small chat under the slide list. Answers come from the uploaded deck only. The server gets the last
// three exchanges so follow-ups work. Reading an answer never touches the meeting audio.

const chat = { history: [] };

function chatMessage(role, text, { quiet = false } = {}) {
  const who = role === "user" ? "You" : "Answer";
  const node = h("div", { class: `msg ${role}${quiet ? " quiet" : ""}` },
    h("span", { class: "sr-only" }, `${who}: `),
    h("p", {}, text));
  $("#chat-log").append(node);
  $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
  return node;
}

function renderChatState() {
  const box = $("#question");
  const button = $("#ask button");
  const hasDeck = state.slides.length > 0;
  const live = Boolean(state.capture);
  box.disabled = button.disabled = !hasDeck || live;
  $("#chat-note").textContent = !hasDeck
    ? "Questions work once the presenter has uploaded the slides."
    : live
      ? "Available before the talk. Disconnect from the Zoom tab to ask questions."
      : "Answers come only from the uploaded slides. If something isn't in them, it will say so.";
}

$("#question").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#ask").requestSubmit();
  }
});

$("#ask").addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = $("#question").value.trim();
  if (!question || $("#question").disabled) return;
  chatMessage("user", question);
  $("#question").value = "";
  const pending = chatMessage("assistant", "Thinking…", { quiet: true });
  try {
    const out = await api(`/api/rooms/${room}/ask`, { method: "POST", json: { question, history: chat.history.slice(-3) } });
    pending.querySelector("p").textContent = out.answer;
    pending.classList.toggle("quiet", !out.found);
    if (out.found) chat.history.push({ question, answer: out.answer });
    if (settings.get("speech.mode") === "voice" && !state.describing) speaker.speak(out.answer);
  } catch (err) {
    pending.querySelector("p").textContent = `Sorry, that failed: ${err.message}`;
    say(`Sorry, that failed: ${err.message}`, { assertive: true });
  }
  $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
  $("#question").focus();
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
