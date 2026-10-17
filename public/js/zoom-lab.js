// Owner: Person 4. Test page logic for public/zoom-lab.html.
import { parseZoomLink, joinAsHelper } from "/js/zoom-helper.js";

const $ = (id) => document.getElementById(id);
const logEl = $("log");
const parseOutput = $("parse-output");
const joinBtn = $("btn-join");
const container = $("zoom-container");

let activeHelper = null;
let sharing = false;

function log(msg) {
  const line = document.createElement("div");
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.append(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function resetContainer() {
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = "Nothing mounted.";
  container.replaceChildren(p);
}

function setShareLabel() {
  $("btn-mock-share").textContent = `Toggle screen share (now: ${sharing ? "on" : "off"})`;
}

// Errors outside our code (like a bad import) should still show up on the page.
window.addEventListener("error", (e) => log(`Page error: ${e.message}`));
window.addEventListener("unhandledrejection", (e) => log(`Unhandled error: ${e.reason?.message || e.reason}`));

// The mock checkbox needs no parsed meeting, so it can enable Mount by itself.
function updateJoinEnabled() {
  const hasMeeting = Boolean(joinBtn.dataset.mn);
  joinBtn.disabled = !($("chk-mock").checked || hasMeeting);
}
$("chk-mock").addEventListener("change", updateJoinEnabled);

// 1. Parser
$("btn-parse").addEventListener("click", () => {
  const result = parseZoomLink($("link-input").value);
  if (result) {
    parseOutput.textContent = `Success. ID: ${result.meetingNumber} | Passcode: ${result.passcode || "(none)"}`;
    joinBtn.dataset.mn = result.meetingNumber;
    joinBtn.dataset.pwd = result.passcode;
  } else {
    parseOutput.textContent = "Invalid link or meeting ID.";
    delete joinBtn.dataset.mn;
    delete joinBtn.dataset.pwd;
  }
  updateJoinEnabled();
});

// 2. Mount and disconnect
joinBtn.addEventListener("click", async () => {
  if (activeHelper) {
    log("Already mounted. Disconnect first.");
    return;
  }
  const mock = $("chk-mock").checked;
  const meetingNumber = joinBtn.dataset.mn || "";
  const passcode = joinBtn.dataset.pwd || "";

  log(mock ? "Mounting fake helper..." : `Joining meeting ${meetingNumber}...`);
  joinBtn.disabled = true;
  try {
    const helper = await joinAsHelper({ meetingNumber, passcode, container, mock });
    helper.addEventListener("speaker", (evt) => log(`speaker: ${evt.detail.name}`));
    helper.addEventListener("share", (evt) => log(`share: ${evt.detail.sharing ? "on" : "off"}${evt.detail.name ? ` (${evt.detail.name})` : ""}`));
    activeHelper = helper;
    log(mock ? "Fake helper ready." : "Joined. Listening for events.");
    if (mock) {
      const note = document.createElement("p");
      note.className = "muted";
      note.textContent = "Fake helper active. No Zoom connection.";
      container.replaceChildren(note);
    }
  } catch (err) {
    log(`Join failed: ${err.message}`);
  } finally {
    updateJoinEnabled();
  }
});

$("btn-leave").addEventListener("click", async () => {
  if (!activeHelper) {
    log("Nothing to disconnect.");
    return;
  }
  try {
    await activeHelper.leave();
  } catch (err) {
    log(`Leave error: ${err.message}`);
  }
  activeHelper = null;
  sharing = false;
  setShareLabel();
  resetContainer();
  log("Disconnected.");
});

// 3. Simulated events
$("btn-mock-speaker").addEventListener("click", () => {
  if (!activeHelper) return log("Mount a helper first (tick the fake helper box to test without Zoom).");
  activeHelper.emitSpeaker("Dr. Aris");
});

$("btn-mock-share").addEventListener("click", () => {
  if (!activeHelper) return log("Mount a helper first (tick the fake helper box to test without Zoom).");
  sharing = !sharing;
  activeHelper.emitShare(sharing, sharing ? "Dr. Aris" : "");
  setShareLabel();
});

log("Zoom lab ready.");
