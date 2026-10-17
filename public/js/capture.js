// Owner: Person 2. Contract: docs/ARCHITECTURE.md, "Browser modules".
export async function startCapture() {
  // TODO(Person 2): add audio: { suppressLocalAudioPlayback: true } once the audio engine plays the meeting itself.
  // Until then the Zoom tab keeps playing its own sound.
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: true, selfBrowserSurface: "exclude" });
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  return { stream, video };
}

// TODO(Person 2): compare frames, crop to the shared area, and call onChange({ at, frame })
// once the screen has changed and held still for about a second. frame is a JPEG Blob.
export function watchSlides(video, { onChange }) {
  return () => {};
}
