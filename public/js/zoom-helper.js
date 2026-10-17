// Owner: Person 4. Contract: docs/ARCHITECTURE.md, "Browser modules".
export function parseZoomLink(text) {
  const s = String(text || "").trim();
  const meetingNumber = s.match(/\/j\/(\d{9,11})/)?.[1] || s.replace(/\s/g, "").match(/^\d{9,11}$/)?.[0];
  if (!meetingNumber) return null;
  // TODO(Person 4): the pwd in invite links is encoded; check what the SDK expects.
  return { meetingNumber, passcode: s.match(/[?&]pwd=([^&\s]+)/)?.[1] || "" };
}

// TODO(Person 4): join as "Accessibility helper", mic and camera off, and fire "speaker" and "share" events.
export async function joinAsHelper({ meetingNumber, passcode, container }) {
  throw new Error("The Zoom helper isn't built yet (Person 4).");
}

// For testing without Zoom: emits whatever speaker you tell it to.
export function fakeHelper() {
  const helper = new EventTarget();
  helper.emitSpeaker = (name) => helper.dispatchEvent(new CustomEvent("speaker", { detail: { name, at: Date.now() } }));
  helper.leave = () => {};
  return helper;
}
