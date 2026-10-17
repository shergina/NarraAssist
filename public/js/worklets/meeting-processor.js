// Owner: Person 2. Runs on the audio thread, driven by audio-engine.js. Messages between the two are private to them.
//
// Input: the meeting, downmixed to mono by the node. Output: what the listener hears.
// live:    input straight through.
// held:    silence, input recorded.
// catchup: the recording, time-stretched with WSOLA so speed rises and pitch stays natural,
//          pauses over ~300 ms shortened; input still recorded until playback reaches live.
// In every mode: 16 kHz 16-bit PCM of the input when asked, and quiet detection.

const FADE_SEC = 0.015; // gain ramps, so mode changes never click
const FRAME_SEC = 0.01; // loudness is measured per 10 ms frame
const SKIP_MIN_SEC = 0.3; // pauses longer than this get shortened
const KEEP_SEC = 0.15; // how much of a long pause is still played
const LEAD_SEC = 0.04; // land this far before speech resumes, so onsets aren't clipped
const QUIET_SEC = 2;
const START_RATE = 1.25;
const RAMP_SEC = 20; // backlog at which speed reaches maxRate
const STATUS_EVERY = 16; // render quanta between status messages, about 40 ms
const PCM_RATE = 16000;
const PCM_CHUNK = 1600; // 100 ms

// Growable recording of mono samples, addressed by absolute input sample index.
class Recording {
  constructor(blockSize = 1 << 15) {
    this.B = blockSize;
    this.reset(0);
  }

  reset(at) {
    this.blocks = [];
    this.base = at; // absolute index of blocks[0][0]
    this.end = at; // one past the last recorded sample
  }

  push(x) {
    for (let i = 0; i < x.length; i++) {
      const off = this.end - this.base;
      const k = Math.floor(off / this.B);
      if (k === this.blocks.length) this.blocks.push(new Float32Array(this.B));
      this.blocks[k][off - k * this.B] = x[i];
      this.end++;
    }
  }

  // Copies out.length samples starting at absolute index `from`. Zeros outside the recording.
  copy(from, out) {
    for (let i = 0; i < out.length; i++) {
      const off = from + i - this.base;
      if (off < 0 || from + i >= this.end) {
        out[i] = 0;
        continue;
      }
      const k = Math.floor(off / this.B);
      out[i] = this.blocks[k][off - k * this.B];
    }
  }

  dropBefore(pos) {
    while (this.blocks.length > 1 && this.base + this.B <= pos) {
      this.blocks.shift();
      this.base += this.B;
    }
  }
}

// RBJ low-pass biquad, used before downsampling to 16 kHz.
class Biquad {
  constructor(sampleRate, freq, q) {
    const w = (2 * Math.PI * freq) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    this.b0 = (1 - cos) / 2 / a0;
    this.b1 = (1 - cos) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }

  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

class MeetingProcessor extends AudioWorkletProcessor {
  constructor({ processorOptions = {} } = {}) {
    super();
    const sr = sampleRate;
    this.mode = "live";
    this.seq = 0;
    this.maxRate = processorOptions.maxRate ?? 2;
    this.threshold = processorOptions.silenceThreshold ?? 0.01; // frame RMS below this is silence
    this.inPos = 0; // absolute input sample index of the next sample in
    this.liveGain = 1; // playback needs no gain of its own: grains fade in and the flushed tail fades out
    this.fadeStep = 1 / (sr * FADE_SEC);
    this.mono = new Float32Array(128);

    // Loudness per frame, for silence skipping and quiet detection
    this.FS = Math.round(sr * FRAME_SEC);
    this.frameSum = 0;
    this.frameLevel = 0;
    this.silent = []; // 1 or 0 per recorded frame
    this.silentBase = 0; // absolute frame index of silent[0]
    this.quietRun = 0; // samples of input silence so far
    this.quietFired = false;

    // Recording and WSOLA playback
    this.rec = new Recording();
    this.N = 2 * Math.round(sr * 0.015); // grain, about 30 ms
    this.Hs = this.N / 2; // synthesis hop
    this.D = Math.round(sr * 0.008); // search tolerance, about 8 ms
    this.win = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.N);
    this.seg = new Float32Array(this.N + 2 * this.D);
    this.nat = new Float32Array(this.Hs);
    this.ola = new Float32Array(this.N);
    this.outQ = new Float32Array(1 << 14);
    this.qHead = 0;
    this.qLen = 0;
    this.anaPos = 0; // absolute input index where the next grain is read, nominally
    this.prevStart = -1; // where the previous grain was actually read; -1 means start fresh
    this.rate = START_RATE;
    this.runStart = null; // first frame of the pause playback is in
    this.skipped = 0; // seconds of pause skipped in this catch-up

    // 16 kHz PCM
    this.pcmOn = false;
    this.pcmStep = sr / PCM_RATE;
    this.pcmPos = 0;
    this.pcmLast = 0;
    const cut = Math.min(7000, sr * 0.45);
    this.lp = [new Biquad(sr, cut, 0.541), new Biquad(sr, cut, 1.307)]; // 4th-order Butterworth
    this.pcmBuf = new Int16Array(PCM_CHUNK);
    this.pcmLen = 0;

    this.ticks = 0;
    this.stopped = false;
    this.port.onmessage = (e) => this.onCommand(e.data);
  }

  onCommand(msg) {
    if (msg.type === "mode") this.setMode(msg.mode, msg.seq);
    else if (msg.type === "max-rate") this.maxRate = msg.rate;
    else if (msg.type === "threshold") this.threshold = msg.value;
    else if (msg.type === "pcm") this.pcmOn = msg.on;
    else if (msg.type === "stop") this.stopped = true;
  }

  setMode(mode, seq) {
    this.seq = seq;
    const from = this.mode;
    if (mode === from) return;
    if (from === "catchup") this.flushTail();
    if (from === "live" && mode !== "live") {
      // Start one continuous recording at this exact sample.
      this.rec.reset(this.inPos);
      this.silent = [];
      this.silentBase = Math.floor(this.inPos / this.FS);
      this.anaPos = this.inPos;
      this.prevStart = -1;
      this.skipped = 0;
    }
    if (mode === "catchup") {
      this.rate = START_RATE;
      this.prevStart = -1;
      this.runStart = null;
    }
    if (mode === "live") this.rec.reset(this.inPos);
    this.mode = mode;
  }

  // The second half of the last grain is still in the overlap buffer. It fades out by itself, so play it.
  flushTail() {
    for (let i = 0; i < this.Hs; i++) this.enqueue(this.ola[i]);
    this.ola.fill(0);
  }

  enqueue(v) {
    const q = this.outQ;
    if (this.qLen === q.length) return;
    q[(this.qHead + this.qLen) % q.length] = v;
    this.qLen++;
  }

  dequeue() {
    if (!this.qLen) return 0;
    const v = this.outQ[this.qHead];
    this.qHead = (this.qHead + 1) % this.outQ.length;
    this.qLen--;
    return v;
  }

  isSilent(frame) {
    const k = frame - this.silentBase;
    return k >= 0 && k < this.silent.length && this.silent[k] === 1;
  }

  // Shortens long pauses by moving the read position. The windowed overlap-add smooths the jump.
  skipPauses() {
    const FS = this.FS;
    const frame = Math.floor(this.anaPos / FS);
    if (!this.isSilent(frame)) {
      this.runStart = null;
      return;
    }
    if (this.runStart === null) this.runStart = frame;
    if ((frame - this.runStart) * FS < KEEP_SEC * sampleRate) return;
    const last = this.silentBase + this.silent.length;
    let end = frame;
    while (end < last && this.isSilent(end)) end++;
    let target = null;
    if (end >= last) target = this.rec.end - this.N - 2 * this.D; // silent right up to live
    else if ((end - this.runStart) * FS > SKIP_MIN_SEC * sampleRate) target = end * FS - LEAD_SEC * sampleRate;
    if (target !== null && target > this.anaPos + this.Hs) {
      this.skipped += (target - this.anaPos) / sampleRate;
      this.anaPos = target;
    }
  }

  // Makes one grain of stretched audio. Returns false when playback has reached live.
  synthGrain() {
    const { N, Hs, D, rec } = this;
    const backlog = (rec.end - this.anaPos) / sampleRate;
    const target = START_RATE + (this.maxRate - START_RATE) * Math.min(1, Math.max(0, backlog / RAMP_SEC));
    this.rate += (target - this.rate) * 0.05;
    this.skipPauses();

    const nominal = Math.round(this.anaPos);
    if (nominal + D + N > rec.end) return false;
    let start = nominal;
    if (this.prevStart >= 0) {
      // WSOLA: pick the offset whose waveform best continues the previous grain.
      rec.copy(nominal - D, this.seg);
      rec.copy(this.prevStart + Hs, this.nat);
      const seg = this.seg;
      const nat = this.nat;
      let best = 0;
      let bestScore = -Infinity;
      for (let d = 0; d <= 2 * D; d += 2) {
        let s = 0;
        for (let i = 0; i < Hs; i += 4) s += seg[d + i] * nat[i];
        if (s > bestScore) {
          bestScore = s;
          best = d;
        }
      }
      for (let d = Math.max(0, best - 1); d <= Math.min(2 * D, best + 1); d += 2) {
        let s = 0;
        for (let i = 0; i < Hs; i += 2) s += seg[d + i] * nat[i];
        if (s > bestScore) {
          bestScore = s;
          best = d;
        }
      }
      start = nominal - D + best;
    }
    rec.copy(start, this.seg.subarray(0, N));
    const ola = this.ola;
    for (let i = 0; i < N; i++) ola[i] += this.seg[i] * this.win[i];
    for (let i = 0; i < Hs; i++) this.enqueue(ola[i]);
    ola.copyWithin(0, Hs);
    ola.fill(0, N - Hs);
    this.prevStart = start;
    this.anaPos += Hs * this.rate;
    rec.dropBefore(Math.min(start, this.anaPos) - 2 * D - N);
    const oldFrames = Math.floor(rec.base / this.FS) - this.silentBase;
    if (oldFrames > 1000) {
      this.silent.splice(0, oldFrames);
      this.silentBase += oldFrames;
    }
    return true;
  }

  // Absolute input index of the sample the listener is hearing right now.
  playPos() {
    if (this.mode === "live") return this.inPos;
    if (this.prevStart < 0) return Math.min(this.anaPos, this.rec.end);
    return Math.max(this.rec.base, this.prevStart + this.Hs - this.qLen * this.rate);
  }

  analyse(x) {
    const FS = this.FS;
    for (let i = 0; i < x.length; i++) {
      this.frameSum += x[i] * x[i];
      if ((this.inPos + i + 1) % FS) continue;
      const rms = Math.sqrt(this.frameSum / FS);
      this.frameSum = 0;
      this.frameLevel = rms;
      const quiet = rms < this.threshold;
      if (this.mode !== "live") this.silent.push(quiet ? 1 : 0);
      if (quiet) this.quietRun += FS;
      else {
        this.quietRun = 0;
        this.quietFired = false;
      }
      if (this.mode !== "live" && !this.quietFired && this.quietRun > QUIET_SEC * sampleRate) {
        this.quietFired = true;
        this.port.postMessage({ type: "quiet" });
      }
    }
  }

  pcm(x) {
    const step = this.pcmStep;
    let pos = this.pcmPos;
    let prev = this.pcmLast;
    for (let i = 0; i < x.length; i++) {
      const y = this.lp[1].run(this.lp[0].run(x[i]));
      while (pos <= i) {
        const v = prev + (y - prev) * (pos - (i - 1));
        this.pcmBuf[this.pcmLen++] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
        if (this.pcmLen === PCM_CHUNK) {
          const buf = this.pcmBuf.buffer;
          this.port.postMessage({ type: "pcm", buffer: buf }, [buf]);
          this.pcmBuf = new Int16Array(PCM_CHUNK);
          this.pcmLen = 0;
        }
        pos += step;
      }
      prev = y;
    }
    this.pcmPos = pos - x.length;
    this.pcmLast = prev;
  }

  process(inputs, outputs) {
    if (this.stopped) return false;
    const out = outputs[0][0];
    const n = out.length;
    const input = inputs[0];
    const x = this.mono.length === n ? this.mono : (this.mono = new Float32Array(n));
    if (input && input.length) x.set(input[0]);
    else x.fill(0);

    this.analyse(x);
    if (this.mode !== "live") this.rec.push(x);
    if (this.pcmOn) this.pcm(x);

    for (let i = 0; i < n; i++) {
      if (!this.qLen && this.mode === "catchup" && !this.synthGrain()) {
        // Reached live. The last grain's tail fades out while live fades in.
        this.setMode("live", this.seq);
        this.port.postMessage({ type: "caught-up", seq: this.seq });
      }
      const target = this.mode === "live" ? 1 : 0;
      this.liveGain += Math.max(-this.fadeStep, Math.min(this.fadeStep, target - this.liveGain));
      out[i] = x[i] * this.liveGain + this.dequeue();
    }
    this.inPos += n;

    if (++this.ticks % STATUS_EVERY === 0) {
      this.port.postMessage({
        type: "status",
        seq: this.seq,
        mode: this.mode,
        t: currentTime + n / sampleRate, // context time of inPos
        playTime: currentTime + (this.playPos() - (this.inPos - n)) / sampleRate,
        rate: this.mode === "catchup" ? this.rate : 1,
        level: this.frameLevel,
        skipped: this.skipped,
        recorded: (this.rec.end - this.rec.base) / sampleRate,
      });
    }
    return true;
  }
}

registerProcessor("meeting-processor", MeetingProcessor);
