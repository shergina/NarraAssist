// Owner: Person 4. The presenter's page.
import { $, api, h, roomCode, slideLabel } from "./common.js";
import { connectSocket, STATUS_TEXT } from "./socket.js";
import { earcons } from "./earcons.js";
import { announce } from "./speech.js";

const room = roomCode();
const state = { slides: [], current: null };
const cards = new Map();
const CUE_TITLES = {
  visuals: "Describe what's on screen?",
  "share-file": "Share the file in the chat?",
  "self-description": "Describe yourself?",
};

$("#room").textContent = room || "none";
const socket = connectSocket(room, "presenter", {
  onMessage,
  onStatus: (s) => ($("#conn").textContent = STATUS_TEXT[s] || s),
});

function onMessage(msg) {
  switch (msg.type) {
    case "state":
      state.slides = msg.state.slides;
      state.current = msg.state.current;
      renderDeck(msg.state.deck);
      $("#transcript").replaceChildren(...msg.state.transcript.map((t) => h("p", {}, t.text)));
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
        source: "From the AI",
        title: CUE_TITLES[msg.nudge.cue] || CUE_TITLES.visuals,
        lines: [msg.nudge.reason, msg.nudge.suggestion && `Try saying: "${msg.nudge.suggestion}"`],
        accept: "I'll do it",
        dismiss: "Not needed",
      });
      break;
    case "request":
      addCard(msg.request.id, {
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
      $("#transcript").append(h("p", {}, msg.entry.text));
      $("#transcript").scrollTop = $("#transcript").scrollHeight;
      break;
  }
}

function addCard(id, { source, title, lines, accept, dismiss }) {
  if (cards.has(id)) return;
  const respond = (action) => {
    socket.send({ type: "respond", id, action });
    removeCard(id);
  };
  const card = h("div", { class: "card", role: "group", "aria-label": title },
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
    new Notification(title, { body: lines.filter(Boolean).join(" "), tag: id });
  }
}

function removeCard(id) {
  cards.get(id)?.remove();
  cards.delete(id);
  $("#no-alerts").hidden = cards.size > 0;
}

$("#notify").addEventListener("click", async () => {
  if (!("Notification" in window)) return announce("This browser doesn't support notifications.");
  const result = await Notification.requestPermission();
  $("#notify").textContent = result === "granted" ? "Notifications on" : "Notifications blocked";
});

$("#deck").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    await api(`/api/rooms/${room}/deck`, { method: "POST", body: file, headers: { "Content-Type": "application/pdf", "X-File-Name": encodeURIComponent(file.name) } });
  } catch (err) {
    $("#deck-status").textContent = `Upload failed: ${err.message}`;
  }
});

function renderDeck(deck) {
  $("#deck-status").textContent = {
    none: "Optional: upload your deck as a PDF so attendees can review it.",
    processing: `Preparing ${deck.fileName}…`,
    ready: `${deck.fileName}: ${deck.slideCount} slides ready for attendees.`,
    error: `Couldn't read the slides: ${deck.error}`,
  }[deck.status];
  $("#jump").replaceChildren(...state.slides.map((s) => h("option", { value: s.number }, slideLabel(s))));
  $("#jump").disabled = $("#prev").disabled = $("#next").disabled = state.slides.length === 0;
  renderCurrent();
}

function renderCurrent() {
  $("#current").textContent = state.current ? slideLabel(state.current) : "Not set";
  if (state.current?.number) $("#jump").value = state.current.number;
}

const goTo = (number) => state.slides.some((s) => s.number === number) && socket.send({ type: "set-slide", number });
$("#prev").addEventListener("click", () => goTo((state.current?.number ?? 2) - 1));
$("#next").addEventListener("click", () => goTo((state.current?.number ?? 0) + 1));
$("#jump").addEventListener("change", (e) => goTo(Number(e.target.value)));
