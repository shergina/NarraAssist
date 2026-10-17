// Owner: Person 3.
import { $, api } from "./common.js";

$("#create").addEventListener("click", async () => {
  const { id } = await api("/api/rooms", { method: "POST" });
  $("#code").textContent = id;
  $("#listener-link").href = `/listener?room=${id}`;
  $("#presenter-link").href = `/presenter?room=${id}`;
  $("#links").hidden = false;
  $("#listener-link").focus();
});

$("#join").addEventListener("submit", (e) => {
  e.preventDefault();
  location.href = `/${e.submitter?.value || "listener"}?room=${encodeURIComponent($("#join-code").value.trim().toUpperCase())}`;
});

api("/api/health")
  .then((h) => ($("#health").textContent = h.gemini === "mock" ? "Gemini: mock data." : `Gemini: live (${h.models.main}).`))
  .catch(() => ($("#health").textContent = "Cannot reach the server."));
