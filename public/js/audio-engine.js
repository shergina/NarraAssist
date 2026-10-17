// Owner: Person 2. Contract: docs/ARCHITECTURE.md, "Browser modules".
// Plays the captured meeting through an AudioWorklet (worklets/meeting-processor.js) so we decide what the
// listener hears: live, held while a description plays, or catching up faster with pauses skipped.
// Never plays earcons or speaks. It only emits events.
//
// A stream with no audio tracks (the Developer tools panel) is accepted: the engine stays silent and
// simulates the modes, with "catch up" taking 2 seconds.

const WORKLET_URL = new URL("./worklets/meeting-processor.js", import.meta.url);
const MIN_RATE = 1.25;
const MAX_RATE = 2.5;
const loaded = new WeakMap(); // AudioContext -> addModule promise, so several engines share one load

const clampRate = (rate) => Math.min(MAX_RATE, Math.max(MIN_RATE, Number(rate) || 2));

export class MeetingAudio extends EventTarget {
  mode = "live";
  #ctx;
  #stream;
  #maxRate;
  #threshold = 0.01;
  #source = null;
  #node = null;
  #seq = 0; // bumps on every mode command, so stale replies from the audio thread are ignored
  #status = null; // latest status from the audio thread
  #heldAt = null; // Date.now() at hold; used until the audio thread reports, and when simulating
  #simTimer = null;
  #simulate = false; // no audio to process: modes change and events fire, but nothing is recorded
  #onPcm = null;
  #stopped = false;
  #ready;

  constructor(audioContext, stream, { maxRate = 2 } = {}) {
    super();
    this.#ctx = audioContext;
    this.#stream = stream;
    this.#maxRate = clampRate(maxRate);
    this.#ready = this.#init();
  }

  get maxRate() {
    return this.#maxRate;
  }

  get secondsBehind() {
    return this.mode === "live" ? 0 : Math.max(0, (Date.now() - this.meetingTime) / 1000);
  }

  get meetingTime() {
    if (this.mode === "live") return Date.now();
    const s = this.#status;
    if (!this.#node || !s || s.seq !== this.#seq || s.mode !== this.mode) return this.#heldAt ?? Date.now();
    const now = this.#ctx.currentTime;
    let t = s.playTime;
    if (this.mode === "catchup") t += Math.max(0, now - s.t) * s.rate;
    return Date.now() - Math.max(0, now - t) * 1000;
  }

  // Extra readouts for the audio lab. Not part of the contract.
  get stats() {
    const s = this.#status;
    return {
      running: Boolean(this.#node),
      rate: this.mode === "catchup" && s ? s.rate : 1,
      level: s ? s.level : 0,
      skipped: s ? s.skipped : 0,
      recorded: this.mode !== "live" && s ? s.recorded : 0,
      sampleRate: this.#ctx.sampleRate,
    };
  }

  hold() {
    if (this.mode === "held") return;
    this.#heldAt ??= Date.now();
    this.#setMode("held");
  }

  catchUp() {
    if (this.mode !== "held") return;
    this.#setMode("catchup");
  }

  skipToLive() {
    this.#setMode("live");
  }

  setMaxRate(rate) {
    this.#maxRate = clampRate(rate);
    this.#post({ type: "max-rate", rate: this.#maxRate });
  }

  // Frame loudness (RMS, 0 to 1) below which the meeting counts as silent. For tuning in the audio lab.
  setSilenceThreshold(value) {
    this.#threshold = value;
    this.#post({ type: "threshold", value });
  }

  // 16 kHz 16-bit mono PCM ArrayBuffers of the live meeting, about 100 ms each, in every mode.
  async streamPcm(onChunk) {
    this.#onPcm = onChunk;
    await this.#ready;
    this.#post({ type: "pcm", on: true });
  }

  stop() {
    if (this.#stopped) return;
    this.#stopped = true;
    clearTimeout(this.#simTimer);
    this.#onPcm = null;
    if (this.#node) {
      this.#node.port.postMessage({ type: "stop" });
      this.#node.port.onmessage = null;
      this.#node.disconnect();
    }
    this.#source?.disconnect();
  }

  async #init() {
    if (!this.#stream.getAudioTracks().length) {
      this.#simulate = true; // nothing to play: stay silent
      return;
    }
    this.#source = this.#ctx.createMediaStreamSource(this.#stream);
    try {
      if (!loaded.has(this.#ctx)) loaded.set(this.#ctx, this.#ctx.audioWorklet.addModule(WORKLET_URL));
      await loaded.get(this.#ctx);
      if (this.#stopped) return;
      const node = new AudioWorkletNode(this.#ctx, "meeting-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
        processorOptions: { maxRate: this.#maxRate, silenceThreshold: this.#threshold },
      });
      node.port.onmessage = (e) => this.#onMessage(e.data);
      this.#source.connect(node).connect(this.#ctx.destination);
      this.#node = node;
      // Catch the audio thread up on anything that happened while the module loaded.
      if (this.mode !== "live") this.#post({ type: "mode", mode: this.mode, seq: this.#seq });
    } catch (err) {
      // The Zoom tab is muted by capture, so never leave the listener with nothing: play it straight through.
      console.warn("[audio] worklet failed, playing the meeting straight through", err);
      this.#simulate = true;
      if (!this.#stopped) this.#source.connect(this.#ctx.destination);
      if (this.mode === "catchup") this.#setMode("catchup");
    }
  }

  #post(msg) {
    this.#node?.port.postMessage(msg);
  }

  #onMessage(msg) {
    if (msg.type === "status") this.#status = msg;
    else if (msg.type === "pcm") this.#onPcm?.(msg.buffer);
    else if (msg.type === "quiet") {
      if (this.mode !== "live") this.dispatchEvent(new Event("presenter-quiet"));
    } else if (msg.type === "caught-up") {
      if (msg.seq !== this.#seq || this.mode !== "catchup") return; // the listener pressed something since
      this.#heldAt = null;
      this.#status = null;
      this.mode = "live";
      this.dispatchEvent(new CustomEvent("mode", { detail: "live" }));
      this.dispatchEvent(new Event("caught-up"));
    }
  }

  #setMode(mode) {
    this.mode = mode;
    this.#seq++;
    if (mode === "live") this.#heldAt = null;
    clearTimeout(this.#simTimer);
    if (this.#node) this.#post({ type: "mode", mode, seq: this.#seq });
    else if (mode === "catchup" && this.#simulate) {
      const seq = this.#seq;
      this.#simTimer = setTimeout(() => this.#onMessage({ type: "caught-up", seq }), 2000);
    }
    this.dispatchEvent(new CustomEvent("mode", { detail: mode }));
  }
}
