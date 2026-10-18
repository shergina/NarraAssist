// Owner: Person 4. The presenter's page.
import { $, api, h, roomCode, slideLabel } from "./common.js";
import { connectSocket, STATUS_TEXT } from "./socket.js";
import { earcons } from "./earcons.js";
import { announce } from "./speech.js";
import { applyDisplaySettings, appearanceSettings } from "./settings.js";

const room = roomCode();
const state = { slides: [], current: null };
const cards = new Map();
let previewUrl = null; // local link to the PDF the presenter picked, never uploaded anywhere
let shownPage = null; // slide currently showing in the preview
let browsing = false; // true while the preview is on a different slide than the live one
const CUE_TITLES = {
  visuals: "Describe what's on screen?",
  "share-file": "Share the file in the chat?",
  "self-description": "Describe yourself?",
};

// Same saved display choices (high contrast, larger text) as the home and listener pages.
applyDisplaySettings();
$("#display-settings").replaceChildren(
  h("p", { class: "muted" }, "These preferences apply to every NarraAssist page in this browser."),
  appearanceSettings(),
);

$("#room").textContent = room || "none";
const socket = connectSocket(room, "presenter", {
  onMessage,
  onStatus: (s) => ($("#conn").textContent = STATUS_TEXT[s] || s),
});

function onMessage(msg) {
  switch (msg.type) {
    case "state":
      state.slides = msg.state.slides || [];
      state.current = msg.state.current ?? null;
      renderDeck(msg.state.deck);
      $("#transcript").replaceChildren(...(msg.state.transcript || []).map((t) => h("p", {}, t.text)));
      $("#transcript-section").hidden = !(msg.state.transcript || []).length;
      break;
    case "deck":
      if (msg.slides) state.slides = msg.slides;
      renderDeck(msg.deck);
      break;
    case "slide":
      state.current = msg.slide;
      renderCurrent();
      break;
    case "nudge":
      addCard(msg.nudge.id, {
        kind: `cue-${CUE_TITLES[msg.nudge.cue] ? msg.nudge.cue : "visuals"}`,
        source: "From the AI",
        title: CUE_TITLES[msg.nudge.cue] || CUE_TITLES.visuals,
        lines: [msg.nudge.reason, msg.nudge.suggestion && `Try saying: "${msg.nudge.suggestion}"`],
        accept: "I'll do it",
        dismiss: "Not needed",
      });
      break;
    case "request":
      addCard(msg.request.id, {
        kind: "cue-request",
        source: "From a listener",
        title: "An attendee asked you to describe the slide",
        lines: [msg.request.note && `They asked: ${msg.request.note}`, msg.request.slide && `Slide ${msg.request.slide}`],
        accept: "Describing it now",
        dismiss: "Can't right now",
      });
      break;
    case "resolved":
      removeCard(msg.id);
      break;
    case "transcript":
      $("#transcript-section").hidden = false;
      $("#transcript").append(h("p", {}, msg.entry.text));
      $("#transcript").scrollTop = $("#transcript").scrollHeight;
      break;
  }
}

function addCard(id, { kind = "", source, title, lines, accept, dismiss }) {
  if (cards.has(id)) return;
  const respond = (action) => {
    socket.send({ type: "respond", id, action });
    removeCard(id);
  };
  const card = h("div", { class: `card ${kind}`.trim(), role: "group", "aria-label": title },
    h("p", { class: "source" }, source),
    h("h3", {}, title),
    lines.filter(Boolean).map((line) => h("p", {}, line)),
    h("div", { class: "row" },
      h("button", { class: "primary", onclick: () => respond("accept") }, accept),
      h("button", { onclick: () => respond("dismiss") }, dismiss)));
  cards.set(id, card);
  $("#no-alerts").hidden = true;
  $("#alerts").prepend(card);
  earcons.attention();
  announce(title, { assertive: true });
  if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.([150, 80, 150]);
  if (document.hidden && "Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, { body: lines.filter(Boolean).join(" "), tag: id });
    } catch {
      // Some phone browsers only allow notifications through a service worker.
      // The card, sound and vibration above still work.
    }
  }
}

function removeCard(id) {
  cards.get(id)?.remove();
  cards.delete(id);
  $("#no-alerts").hidden = cards.size > 0;
}

function renderNotifications() {
  const granted = "Notification" in window && Notification.permission === "granted";
  $("#notify").hidden = granted;
  $("#notify-status").hidden = !granted;
}
renderNotifications();

$("#notify").addEventListener("click", async () => {
  if (!("Notification" in window)) return announce("This browser doesn't support notifications.");
  const result = await Notification.requestPermission();
  renderNotifications();
  if (result !== "granted") $("#notify").textContent = "Notifications blocked in this browser";
});

$("#upload").addEventListener("click", () => $("#deck").click());
$("#deck").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.type === "application/pdf") showPreview(file);
  try {
    await api(`/api/rooms/${room}/deck`, { method: "POST", body: file, headers: { "Content-Type": "application/pdf", "X-File-Name": encodeURIComponent(file.name) } });
  } catch (err) {
    $("#deck-status").textContent = `Upload failed: ${err.message}`;
    announce(`Upload failed: ${err.message}`);
  }
});

function renderDeck(deck = { status: "none" }) {
  $("#deck-status").textContent = {
    none: "Optional: upload your deck so attendees can review it before the talk.",
    processing: `Preparing ${deck.fileName}…`,
    ready: `${deck.fileName}: ${deck.slideCount} slides ready for attendees.`,
    error: `Couldn't read the slides: ${deck.error}`,
  }[deck.status] ?? "";
  $("#jump").replaceChildren(...state.slides.map((s) => h("option", { value: s.number }, slideLabel(s))));
  $("#slides-section").hidden = state.slides.length === 0;
  renderCurrent();
}

// The preview shows the chosen PDF one slide at a time. It runs entirely in the
// browser, so it works even if the upload fails. It follows the live slide until
// the presenter browses with the preview buttons, then stays put until they press
// "Back to live slide".
const liveSlide = () => state.current?.number || 1;
const totalSlides = () => state.slides.length || 1;

function showPreview(file) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  shownPage = null;
  browsing = false;
  for (const id of ["#preview-section", "#preview", "#preview-status", "#preview-controls", "#open-preview"]) $(id).hidden = false;
  updatePreview();
}

function showPage(page) {
  if (!previewUrl) return;
  const target = Math.min(Math.max(page, 1), totalSlides());
  if (target !== shownPage) {
    shownPage = target;
    // A new frame each time, so the viewer always jumps to the page.
    const frame = $("#preview");
    const fresh = frame.cloneNode(false);
    fresh.hidden = false;
    fresh.src = `${previewUrl}#page=${target}&view=Fit&toolbar=0&navpanes=0&scrollbar=0`;
    frame.replaceWith(fresh);
    $("#open-preview").href = `${previewUrl}#page=${target}`;
  }
  updatePreviewControls();
}

function updatePreviewControls() {
  const live = liveSlide();
  const where = `slide ${shownPage} of ${totalSlides()}`;
  $("#preview-status").textContent = shownPage === live ? `Previewing ${where}, the live slide.` : `Previewing ${where}. The live slide is ${live}.`;
  $("#pv-prev").disabled = shownPage <= 1;
  $("#pv-next").disabled = shownPage >= totalSlides();
  $("#pv-live").disabled = shownPage === live;
}

function updatePreview() {
  if (!previewUrl) return;
  if (browsing) updatePreviewControls();
  else showPage(liveSlide());
}

function browse(delta) {
  if (!previewUrl) return;
  const target = Math.min(Math.max((shownPage ?? liveSlide()) + delta, 1), totalSlides());
  browsing = target !== liveSlide();
  showPage(target);
}

function renderCurrent() {
  $("#current").textContent = state.current ? slideLabel(state.current) : "not set";
  if (state.current?.number) $("#jump").value = state.current.number;
  updatePreview();
}

const goTo = (number) => state.slides.some((s) => s.number === number) && socket.send({ type: "set-slide", number });
$("#prev").addEventListener("click", () => goTo((state.current?.number ?? 2) - 1));
$("#next").addEventListener("click", () => goTo((state.current?.number ?? 0) + 1));
$("#jump").addEventListener("change", (e) => goTo(Number(e.target.value)));

// Preview-only buttons. These never change the live slide for attendees.
$("#pv-prev").addEventListener("click", () => browse(-1));
$("#pv-next").addEventListener("click", () => browse(1));
$("#pv-live").addEventListener("click", () => {
  browsing = false;
  showPage(liveSlide());
});