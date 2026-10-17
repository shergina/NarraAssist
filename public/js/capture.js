// Owner: Person 2. Contract: docs/ARCHITECTURE.md, "Browser modules".

// Opens Chrome's share picker. Rejects if the user cancels.
// suppressLocalAudioPlayback silences the Zoom tab itself; audio-engine.js plays the meeting instead.
// If the user forgets "Also share tab audio" there is no audio track: the Zoom tab keeps its own sound
// and the engine stays silent, so the listener still hears the meeting, just without pause and catch-up.
export async function startCapture() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 5 },
    audio: { suppressLocalAudioPlayback: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    selfBrowserSurface: "exclude",
  });
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  return { stream, video };
}

// Slide watching works on a small grayscale copy of the video split into a grid of cells.
// Cells that keep changing are live video (camera tiles, a playing clip) and are ignored.
// Strips of them along the edges are cropped off, which leaves the shared content.
// A slide change is many still cells changing from the last settled screen, then holding still.
const AW = 256; // analysis width in pixels
const CELL = 8; // cell size in analysis pixels
const TICK_MS = 250;
const WARMUP_MS = 1500; // learn which cells are moving before firing anything
const SETTLE_MS = 1000;
const PIXEL_DIFF = 24; // brightness change, 0 to 255, that counts as a changed pixel
const CELL_CHANGED = 0.06; // share of a cell's pixels that must change for the cell to count
const MOTION_DECAY = 0.85; // per tick; a cell that changes on every tick tends to 1
const MOVING = 0.3; // motion score above which a cell is live video
const EDGE_MOVING = 0.2; // an edge row or column with this share of moving cells is cropped off
const CHANGED_SHARE = 0.015; // share of watched cells that must differ from the settled screen
const CHANGED_MIN = 6; // and at least this many, so a mouse pointer never counts
const STILL_SHARE = 0.004; // at most this share of watched cells may still be changing when settled
const MAX_FRAME_WIDTH = 1280;

// onChange({ at, frame }) once each time the shared screen changes and then holds still for about 1 second,
// and once for the screen already showing when watching starts, so there is a slide to describe right away.
// frame is a JPEG Blob of the shared-content area only. Never calls the server, never plays sounds.
// onTick (optional, for the audio lab) gets { box, watched, changed, moving, settling } on every check.
export function watchSlides(video, { onChange, onTick } = {}) {
  const small = document.createElement("canvas");
  const sctx = small.getContext("2d", { willReadFrequently: true });
  let w = 0;
  let h = 0;
  let cols = 0;
  let rows = 0;
  let prev = null; // luminance of the previous tick
  let ref = null; // luminance of the last settled screen
  let motion = null; // per cell
  let startedAt = 0;
  let stillFor = 0;
  let first = true; // the screen showing at the start hasn't been reported yet
  let stopped = false;

  function reset(width, height) {
    w = small.width = width;
    h = small.height = height;
    cols = w / CELL;
    rows = h / CELL;
    prev = ref = null;
    motion = new Float32Array(cols * rows);
    startedAt = performance.now();
    stillFor = 0;
    first = true;
  }

  function luminance() {
    sctx.drawImage(video, 0, 0, w, h);
    const px = sctx.getImageData(0, 0, w, h).data;
    const out = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8;
    return out;
  }

  // Share of changed pixels in each cell between two frames.
  function cellDiff(a, b) {
    const out = new Float32Array(cols * rows);
    for (let y = 0; y < h; y++) {
      const rowBase = (y / CELL | 0) * cols;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (Math.abs(a[i] - b[i]) > PIXEL_DIFF) out[rowBase + (x / CELL | 0)]++;
      }
    }
    for (let c = 0; c < out.length; c++) out[c] /= CELL * CELL;
    return out;
  }

  // Shrinks the full frame by peeling off edge rows and columns that are mostly live video.
  function contentBox() {
    const box = { c0: 0, r0: 0, c1: cols, r1: rows }; // c1 and r1 are exclusive
    const share = (c0, r0, c1, r1) => {
      let n = 0;
      let moving = 0;
      for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++, n++) if (motion[r * cols + c] > MOVING) moving++;
      return n ? moving / n : 0;
    };
    while (box.c1 - box.c0 > 4 && box.r1 - box.r0 > 4) {
      const edges = [
        ["r0", share(box.c0, box.r0, box.c1, box.r0 + 1)],
        ["r1", share(box.c0, box.r1 - 1, box.c1, box.r1)],
        ["c0", share(box.c0, box.r0, box.c0 + 1, box.r1)],
        ["c1", share(box.c1 - 1, box.r0, box.c1, box.r1)],
      ].sort((a, b) => b[1] - a[1]);
      if (edges[0][1] < EDGE_MOVING) break;
      const side = edges[0][0];
      box[side] += side.endsWith("0") ? 1 : -1;
    }
    return box;
  }

  async function emit(box) {
    const at = Date.now();
    const sx = (box.c0 * CELL * video.videoWidth) / w;
    const sy = (box.r0 * CELL * video.videoHeight) / h;
    const sw = ((box.c1 - box.c0) * CELL * video.videoWidth) / w;
    const sh = ((box.r1 - box.r0) * CELL * video.videoHeight) / h;
    const scale = Math.min(1, MAX_FRAME_WIDTH / sw);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    canvas.getContext("2d").drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const frame = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (frame && !stopped) onChange?.({ at, frame });
  }

  function tick() {
    if (stopped || !video.videoWidth || video.readyState < 2) return;
    const height = Math.max(CELL, Math.round((AW * video.videoHeight) / video.videoWidth / CELL) * CELL);
    if (AW !== w || height !== h) reset(AW, height);
    const cur = luminance();
    if (!prev) {
      prev = ref = cur;
      return;
    }
    const fromPrev = cellDiff(cur, prev);
    for (let c = 0; c < motion.length; c++) motion[c] = motion[c] * MOTION_DECAY + (fromPrev[c] > CELL_CHANGED ? 1 - MOTION_DECAY : 0);
    prev = cur;
    if (performance.now() - startedAt < WARMUP_MS) {
      ref = cur;
      return;
    }

    const box = contentBox();
    const fromRef = cellDiff(cur, ref);
    let watched = 0;
    let changed = 0;
    let moving = 0;
    for (let r = box.r0; r < box.r1; r++) {
      for (let c = box.c0; c < box.c1; c++) {
        const i = r * cols + c;
        if (motion[i] > MOVING) continue;
        watched++;
        if (fromRef[i] > CELL_CHANGED) changed++;
        if (fromPrev[i] > CELL_CHANGED) moving++;
      }
    }
    const settling = first || changed >= Math.max(CHANGED_MIN, watched * CHANGED_SHARE);
    if (!settling) stillFor = 0;
    else if (moving > watched * STILL_SHARE) stillFor = 0;
    else stillFor += TICK_MS;
    onTick?.({ box: toVideoBox(box), watched, changed, moving, settling });
    if (settling && stillFor >= SETTLE_MS) {
      ref = cur;
      stillFor = 0;
      first = false;
      emit(box);
    }
  }

  // The crop in video pixels, for the lab's readout.
  function toVideoBox(box) {
    const sx = video.videoWidth / w;
    const sy = video.videoHeight / h;
    return {
      x: Math.round(box.c0 * CELL * sx),
      y: Math.round(box.r0 * CELL * sy),
      width: Math.round((box.c1 - box.c0) * CELL * sx),
      height: Math.round((box.r1 - box.r0) * CELL * sy),
    };
  }

  const timer = setInterval(tick, TICK_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
