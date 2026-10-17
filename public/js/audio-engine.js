// Owner: Person 2. Contract: docs/ARCHITECTURE.md, "Browser modules".
// STUB: changes modes and fires events like the real engine, but plays and records nothing.
// "catch up" pretends to take 2 seconds so the listener page can be built against it.
export class MeetingAudio extends EventTarget {
  constructor(audioContext, stream, { maxRate = 2 } = {}) {
    super();
    this.ctx = audioContext;
    this.stream = stream;
    this.maxRate = maxRate;
    this.mode = "live";
    this.heldAt = null;
  }

  get secondsBehind() {
    return this.heldAt ? (Date.now() - this.heldAt) / 1000 : 0;
  }

  get meetingTime() {
    return this.heldAt ?? Date.now();
  }

  hold() {
    if (this.mode === "held") return;
    this.heldAt ??= Date.now();
    this.#setMode("held");
  }

  catchUp() {
    if (this.mode !== "held") return;
    this.#setMode("catchup");
    setTimeout(() => {
      if (this.mode !== "catchup") return;
      this.heldAt = null;
      this.#setMode("live");
      this.dispatchEvent(new Event("caught-up"));
    }, 2000);
  }

  skipToLive() {
    this.heldAt = null;
    this.#setMode("live");
  }

  setMaxRate(rate) {
    this.maxRate = rate;
  }

  // TODO(Person 2): 16 kHz 16-bit mono PCM ArrayBuffers of the live meeting.
  async streamPcm(onChunk) {}

  stop() {}

  #setMode(mode) {
    this.mode = mode;
    this.dispatchEvent(new CustomEvent("mode", { detail: mode }));
  }
}
