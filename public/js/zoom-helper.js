// Owner: Person 4. Contract: docs/ARCHITECTURE.md, "Browser modules".

// Zoom Meeting SDK, Component View. CHECK Zoom's Meeting SDK docs for the
// current version number and script URL, and update this if the load fails.
const SDK_VERSION = "3.13.2";
const SDK_URL = `https://source.zoom.us/${SDK_VERSION}/zoom-meeting-embedded-${SDK_VERSION}.min.js`;

export function parseZoomLink(text) {
  const s = String(text || "").trim();

  // Full invite links: .../j/123456789?pwd=... or .../wc/join/123456789
  const matchUrl = s.match(/\/(?:j|wc\/join)\/(\d{9,11})/);
  // Raw meeting IDs, with or without spaces or dashes: 123 4567 8901
  const matchRaw = s.replace(/[\s-]/g, "").match(/^\d{9,11}$/);

  const meetingNumber = matchUrl ? matchUrl[1] : matchRaw ? matchRaw[0] : null;
  if (!meetingNumber) return null;

  const pwdMatch = s.match(/[?&]pwd=([^&\s]+)/);
  const passcode = pwdMatch ? pwdMatch[1] : "";

  return { meetingNumber: String(meetingNumber), passcode: String(passcode) };
}

// Every helper, real or fake, has the same shape:
//   events: "speaker" {name, at}, "share" {sharing, name, at}
//   methods: emitSpeaker(name), emitShare(sharing, name), leave()
function createHelper() {
  const helper = new EventTarget();
  helper.emitSpeaker = (name) =>
    helper.dispatchEvent(new CustomEvent("speaker", { detail: { name, at: Date.now() } }));
  helper.emitShare = (sharing, name = "") =>
    helper.dispatchEvent(new CustomEvent("share", { detail: { sharing, name, at: Date.now() } }));
  helper.leave = async () => {};
  return helper;
}

let sdkPromise = null;
function loadSdk() {
  if (window.ZoomMtgEmbedded) return Promise.resolve();
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SDK_URL;
      script.onload = () =>
        window.ZoomMtgEmbedded
          ? resolve()
          : reject(new Error("Zoom SDK script loaded but ZoomMtgEmbedded is missing."));
      script.onerror = () => {
        sdkPromise = null;
        reject(new Error(`Could not load the Zoom SDK from ${SDK_URL}. Check the version number.`));
      };
      document.head.append(script);
    });
  }
  return sdkPromise;
}

function showError(container, message) {
  if (!container) return;
  const box = document.createElement("div");
  box.style.cssText = "padding:1rem;border:2px dashed #e53e3e;border-radius:8px;";
  const title = document.createElement("strong");
  title.textContent = "Zoom helper failed to join";
  const detail = document.createElement("p");
  detail.textContent = message;
  box.append(title, detail);
  container.replaceChildren(box);
}

// Joins as "Accessibility helper" using the Zoom Meeting SDK Component View.
// Throws if anything goes wrong, so callers see the real error.
// Pass mock: true to skip Zoom entirely and get a fake helper.
export async function joinAsHelper({ meetingNumber, passcode = "", container, mock = false }) {
  if (mock) return fakeHelper();

  const helper = createHelper();

  try {
    const response = await fetch("/api/zoom/signature", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingNumber }),
    });
    if (!response.ok) {
      throw new Error(`Signature request failed: ${response.status} ${response.statusText}`);
    }
    const { signature, sdkKey } = await response.json();
    if (!signature || !sdkKey) {
      throw new Error("Server did not return a signature and sdkKey. Check ZOOM_SDK_KEY and ZOOM_SDK_SECRET in .env.");
    }

    await loadSdk();
    const client = window.ZoomMtgEmbedded.createClient();
    await client.init({ zoomAppRoot: container, language: "en-US" });

    await client.join({
      sdkKey,
      signature,
      meetingNumber,
      password: passcode,
      userName: "Accessibility helper",
    });

    // The exact event payloads below are best guesses. The console.log lines
    // show what Zoom really sends, so adjust once you see it.
    client.on("active-speaker", (data) => {
      console.log("[Zoom Helper] active-speaker payload", data);
      const first = Array.isArray(data) ? data[0] : data;
      const name = first?.displayName || first?.user?.name || first?.name;
      if (name) helper.emitSpeaker(name);
    });

    client.on("active-share-change", (data) => {
      console.log("[Zoom Helper] active-share-change payload", data);
      const sharing = data?.state === "Active" || data?.active === true;
      helper.emitShare(sharing, data?.displayName || "");
    });

    helper.leave = async () => {
      await client.leave();
      if (container) container.replaceChildren();
    };

    return helper;
  } catch (error) {
    console.error("[Zoom Helper] join failed", error);
    showError(container, error.message);
    throw error;
  }
}

// A stand-in with the same shape, for testing without a Zoom meeting.
export function fakeHelper() {
  return createHelper();
}
