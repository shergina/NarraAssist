// Owner: Person 4. Service worker for the presenter page. Turns pushes into system notifications, so a prompt
// reaches the presenter's phone even when the page is closed or the screen is locked.
// A push carries no data. On each one, ask the server what is waiting for this browser's subscription.

// Keep in step with CUE_TITLES and the card wording in public/js/presenter.js.
const CUE_TITLES = {
  visuals: "Describe what's on screen?",
  "share-file": "Share the file in the chat?",
  "self-description": "Describe yourself?",
};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => event.waitUntil(showPending()));

async function showPending() {
  const sub = await self.registration.pushManager.getSubscription();
  let data = { room: null, items: [] };
  try {
    const res = await fetch("/api/push/pending", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub?.endpoint }) });
    if (res.ok) data = await res.json();
  } catch {
    // Offline or the server restarted. Fall through to the generic notice below.
  }

  // An open, visible presenter page already shows the card, plays the sound and vibrates.
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (windows.some((w) => w.visibilityState === "visible" && new URL(w.url).pathname.startsWith("/presenter"))) return;

  const shown = new Set((await self.registration.getNotifications()).map((n) => n.tag));
  const fresh = data.items.filter((item) => !shown.has(item.id));
  for (const item of fresh) await self.registration.showNotification(...describe(item, data.room));
  // Every push must show something, or the browser shows its own vaguer notice.
  if (!fresh.length && !shown.size) {
    await self.registration.showNotification("NarraAssist", { body: "Open the presenter page to see what attendees need.", tag: "narraassist", data: { room: data.room } });
  }
}

function describe(item, room) {
  const options = { tag: item.id, renotify: true, requireInteraction: true, vibrate: [150, 80, 150], data: { room, id: item.id } };
  if (item.kind === "request") {
    const lines = [item.note && `They asked: ${item.note}`, item.slide && `Slide ${item.slide}`];
    return ["An attendee asked you to describe the slide", { ...options, body: lines.filter(Boolean).join(" "), actions: [{ action: "accept", title: "Describing it now" }, { action: "dismiss", title: "Can't right now" }] }];
  }
  const lines = [item.reason, item.suggestion && `Try saying: "${item.suggestion}"`];
  return [CUE_TITLES[item.cue] || CUE_TITLES.visuals, { ...options, body: lines.filter(Boolean).join(" "), actions: [{ action: "accept", title: "I'll do it" }, { action: "dismiss", title: "Not needed" }] }];
}

self.addEventListener("notificationclick", (event) => {
  const { room, id } = event.notification.data || {};
  event.notification.close();
  if (event.action && room && id) {
    event.waitUntil(fetch(`/api/rooms/${encodeURIComponent(room)}/respond`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: event.action }) }).catch(() => {}));
    return;
  }
  event.waitUntil(openPresenter(room));
});

async function openPresenter(room) {
  const url = room ? `/presenter?room=${encodeURIComponent(room)}` : "/presenter";
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const open = windows.find((w) => new URL(w.url).pathname.startsWith("/presenter"));
  if (open) return open.focus();
  return self.clients.openWindow(url);
}
