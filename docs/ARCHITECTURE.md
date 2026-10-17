# Architecture and message formats

This is the contract between the pages and the server. Four people and their AI tools build against it in parallel, so change it deliberately and in the same commit as the code.

## Pieces

```
Zoom web client tab ──(Chrome tab capture: video + audio)──► Listener page (Chrome)
                                                              │ plays meeting audio: live, paused, catch-up
                                                              │ detects screen changes locally, plays the knock
                                                              │ sends a JPEG frame on each change
                                                              │ streams 16 kHz PCM audio for transcription
                                                              ▼
                                 Node server: Express routes + one WebSocket per tab, one room per meeting
                                                              │ holds the Gemini key and all prompts
                                                              │ deck processing, frame description, transcription, cues, Q&A
                                                              ▼
                                                     Presenter page (phone or second screen)
```

Rooms are in memory. A server restart clears them.

## Shared objects

```js
// Slide. number is null when there is no deck and the slide came from a screenshot.
{ number: 3, title: "Q3 revenue", text: "…", visuals: "A bar chart showing…", overview: "This slide…" }

// Deck status
{ status: "none" | "processing" | "ready" | "error", fileName, error, slideCount }

// Transcript entry
{ at: 1760000000000, text: "So as you can see here the numbers went up" }

// Pending item shown to the presenter. kind is "nudge" (from the AI) or "request" (from the listener).
{ id, kind: "nudge", reason, suggestion, slide, at }
{ id, kind: "request", note, slide, at }
```

## HTTP routes

| Method and path | Body | Returns |
|---|---|---|
| `GET /api/health` | | `{ ok, gemini, models }` |
| `POST /api/rooms` | | `201 { id }` |
| `GET /api/rooms/:id` | | room state: `{ id, deck, summary, slides, current, transcript }` |
| `POST /api/rooms/:id/deck` | PDF bytes, `Content-Type: application/pdf`, `X-File-Name` | `202 { deck }`, then a `deck` socket message when done |
| `GET /api/rooms/:id/deck.pdf` | | the PDF |
| `POST /api/rooms/:id/frame` | JPEG bytes of the shared area, header `X-Captured-At` | `{ changed, slide }`. Described at most once every 3 s per room; the newest frame wins |
| `POST /api/rooms/:id/ask` | `{ question }` | `{ answer }` |

Errors are `{ error: "message" }` with a 4xx or 5xx status. 503 means no Gemini key.

## WebSocket

Connect to `/ws?room=CODE&role=listener|presenter`. Text frames are JSON. Binary frames from a listener are 16 kHz mono 16-bit PCM audio.

Server to everyone in the room:

| type | fields | when |
|---|---|---|
| `state` | `state` (room state) | right after connecting |
| `deck` | `deck`, and `summary` + `slides` when ready | upload started or finished |
| `slide` | `slide`, `source: "screen" \| "presenter"` | the current slide changed |
| `transcript` | `entry` | a new chunk was transcribed |

Server to presenters only:

| type | fields | when |
|---|---|---|
| `nudge` | `nudge` | the AI thinks the presenter should describe something |
| `request` | `request` | a listener asked for a description |
| `resolved` | `id` | a nudge or request was answered, by any presenter tab |

Server to listeners only:

| type | fields | when |
|---|---|---|
| `request-sent` | `hasPresenter` | their request was stored |
| `presenter-response` | `kind`, `action: "accept" \| "dismiss"`, `slide` | the presenter answered |

Listener to server:

| type | fields |
|---|---|
| `request-description` | `note` (optional, up to 300 chars) |
| binary | PCM audio |

Presenter to server:

| type | fields |
|---|---|
| `respond` | `id`, `action: "accept" \| "dismiss"` |
| `set-slide` | `number` |

## Planned additions

These are agreed but not built. Add them here when they land.

- Speaker names from the Zoom Meeting SDK for web. The listener page loads the SDK and joins the same meeting as a visible participant named "Accessibility helper", with its audio and video off. It listens for active-speaker events and announces names locally: only while hearing the speaker, never during a description, and during catch-up when playback reaches the time the person started talking. No server message is needed for names.
- `POST /api/zoom/signature` with `{ meetingNumber }` returns `{ signature, sdkKey }`. The server signs the SDK join token with `ZOOM_SDK_KEY` and `ZOOM_SDK_SECRET` from `.env`. The secret never reaches the browser.
- Fallback if the SDK fails: the listener page crops the active-speaker tile on voice onset and the server asks Gemini to read the name.
- Nudge gets `cue: "visuals" | "share-file" | "self-description"` and `source: "ai" | "listener"`.
- Spoken overview audio per slide, generated with Gemini text-to-speech at upload: `GET /api/rooms/:id/slides/:number/audio`.
- Listener settings, stored in `localStorage`: each earcon and announcement on or off, voice speed, catch-up speed cap.
- Frame description in the background right after each slide change, so a description is ready before the listener asks.

## Browser modules

These run in the listener page. Each has one owner, and Person 3's `listener.js` wires them together. These are the target contracts.

### `public/js/capture.js`, Person 2

```js
startCapture() -> Promise<{ stream, video }>
// Opens Chrome's share picker. Rejects if the user cancels.

watchSlides(video, { onChange }) -> stop()
// onChange({ at, frame }) fires once each time the shared screen changes and then holds still for about 1 second.
// at: Date.now() when it settled. frame: JPEG Blob of the shared-content area only, at most 1280 px wide.
// Never calls the server, never plays sounds.
```

### `public/js/audio-engine.js`, Person 2

```js
const audio = new MeetingAudio(audioContext, stream, { maxRate: 2 });

audio.mode           // "live" | "held" | "catchup"
audio.secondsBehind  // seconds of meeting audio not yet heard
audio.meetingTime    // Date.now()-style time when the audio playing right now was originally spoken. Equals Date.now() when live.

audio.hold()             // silence the meeting and start recording
audio.catchUp()          // play the recording, silences over ~300 ms skipped, speed rising from 1.25x toward maxRate, until live
audio.skipToLive()       // drop the recording, back to live
audio.setMaxRate(rate)   // 1.25 to 2.5
audio.streamPcm(onChunk) // 16 kHz 16-bit mono PCM ArrayBuffers of the live meeting, in every mode
audio.stop()

// Events
"mode"             event.detail is the new mode string
"caught-up"        reached live after catching up
"presenter-quiet"  meeting silent for more than 2 s while the listener is not hearing live; once per silence
// Never plays earcons or speaks.
```

### `public/js/zoom-helper.js`, Person 4

```js
parseZoomLink(text) -> { meetingNumber, passcode } | null
// Accepts a pasted Zoom invite link or a meeting ID.

const helper = await joinAsHelper({ meetingNumber, passcode, container });
// Joins as a visible participant named "Accessibility helper" with mic and camera off.
// container: a hidden element for the SDK's own UI. Gets its signature from POST /api/zoom/signature.

"speaker"  event.detail = { name, at }                // a different person became the active speaker; at is Date.now()
"share"    event.detail = { sharing, name, at }       // only if the SDK reports sharing; sharing is true or false
"error"    event.detail = { message }
helper.leave()
// Never plays sounds or speaks.
```

### `public/js/speech.js`, `earcons.js`, `settings.js`, Person 3

```js
announce(text, { assertive })        // to the screen reader through a live region
const speaker = new Speaker();       // built-in voice or the user's screen reader, per settings
speaker.speak(text, { onEnd }) -> boolean   // true if onEnd will fire when speech finishes
speaker.cancel()

earcons.slideChanged() / presenterQuiet() / caughtUp() / attention()   // each checks settings first

settings.get(key) / settings.set(key, value)   // saved in localStorage
// keys: sound.slideChanged, sound.presenterQuiet, sound.caughtUp, announce.speaker, announce.slideTitle,
//       voice.rate, catchup.maxRate, speech.mode ("voice" | "screen-reader"). Every sound and announcement defaults to on.
```

The presenter page may import these. Only Person 3 changes them.

## What the listener hears

Person 3 implements these rules in `listener.js`.

- **Slide changed.** On `watchSlides` `onChange`, play the knock and post the frame to `/api/rooms/:id/frame`. A `slide` message with `source: "screen"` updates the content silently, since the knock already played. A `slide` message with `source: "presenter"` plays the knock and updates the content.
- **During a description.** Earcons still play. Words wait in a queue and play when the description ends, or can be heard with Alt+Shift+A.
- **Speaker names.** Keep a list of `{ name, at }` from the Zoom helper. While live, announce a name as it arrives. During a description, announce nothing. During catch-up, announce each name when `audio.meetingTime` reaches its `at`. When playback resumes after a description, first announce the latest speaker whose `at` is at or before `audio.meetingTime`. Never announce the same name twice in a row.
- **Presenter quiet.** Play the falling tone. Queue the words if a description is playing.
- **Caught up.** Play the rising sweep.

## Mock mode

With `MOCK_GEMINI=1` in `.env`, every function in `server/gemini.js` returns realistic canned data after a short delay, and nothing calls Google. Person 1 builds this first so other lanes can work without a key or quota.

## Listener audio modes

| Mode | What plays | What is recorded |
|---|---|---|
| `live` | the meeting, straight through | nothing |
| `held` | the slide description | the meeting |
| `catchup` | the recording, silences skipped, speed rising from 1.25x toward the cap | the meeting, until playback reaches live |

## Keyboard shortcuts

See the table in PRODUCT.md. Shortcuts are handled in `public/js/listener.js` and must stay in sync with that table.
