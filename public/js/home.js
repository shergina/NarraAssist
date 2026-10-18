// Owner: Person 3.
import { $, api } from "./common.js";
import { applyDisplaySettings, appearanceSettings } from "./settings.js";

applyDisplaySettings();
$("#display-settings").replaceChildren(appearanceSettings());

$("#create").addEventListener("click", async () => {
  const button = $("#create");
  button.disabled = true;
  $("#room-status").textContent = "";
  try {
    const { id } = await api("/api/rooms", { method: "POST" });
    $("#code").textContent = id;
    $("#listener-link").href = `/listener?room=${id}`;
    $("#presenter-link").href = `/presenter?room=${id}`;
    $("#links").hidden = false;
    $("#listener-link").focus();
  } catch (err) {
    $("#room-status").textContent = `Couldn't create a room: ${err.message}`;
  } finally {
    button.disabled = false;
  }
});

$("#join").addEventListener("submit", (e) => {
  e.preventDefault();
  location.href = `/${e.submitter?.value || "listener"}?room=${encodeURIComponent($("#join-code").value.trim().toUpperCase())}`;
});

api("/api/health")
  .then((h) => ($("#health").textContent = h.gemini === "mock" ? "Gemini: mock data." : `Gemini: live (${h.models.main}).`))
  .catch(() => ($("#health").textContent = "Cannot reach the server."));
