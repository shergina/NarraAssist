# Who builds what

This file gives each of the four of us an exact brief: what you own, what you build and in what order, what you hand to others, and what you get from them. The goal is that four people and four AI agents can work in parallel all weekend and merge without conflicts.

The exact shapes of everything that crosses between lanes, including routes, messages and browser module functions, are in [ARCHITECTURE.md](ARCHITECTURE.md). This file says who produces and who consumes each one. If the two disagree, fix ARCHITECTURE.md first.

| Lane | Person | Name |
|---|---|---|
| AI brain | Person 1 | _fill in_ |
| Live audio | Person 2 | _fill in_ |
| Listener experience | Person 3 | _fill in_ |
| Presenter, Zoom and demo | Person 4 | _fill in_ |

## Starting an AI session

Paste this as the first message of every session, with your number:

```
I am Person N on this team. Read AGENTS.md, docs/ROLES.md and docs/ARCHITECTURE.md.
Work only on the files my lane owns. If a task needs a change in another lane's file
or in a contract in ARCHITECTURE.md, stop and tell me instead of making it.
```

## Rules that prevent merge conflicts

1. **Only edit files your lane owns.** Every file in the repo has exactly one owner, listed below. If you need a change in someone else's file, message them. They make it, or they tell you to go ahead.
2. **Contract first, code second.** To change a route, a message, an event or a function another lane calls, edit ARCHITECTURE.md in its own small pull request, tell the team, merge it, then write the code.
3. **Small branches, merged fast.** Name branches `p2/silence-skip`. Rebase on `main`, run `npm run check`, open a pull request, merge within the hour, delete the branch.
4. **Use the mocks, don't rebuild other lanes.** If another lane isn't ready, use its test tool: mock Gemini mode, the audio lab page, or the Zoom lab page. Never write your own copy of another lane's module.
5. **No drive-by changes.** Don't reformat, rename or "clean up" code outside your lane, and tell your AI agent the same.
6. **Single owners for shared files.** `package.json` and everything in `server/` belong to Person 1, except `server/zoom.js`. `public/css/styles.css`, the home page and the listener page belong to Person 3. Dependency changes need the team's OK.

## Where the code lives

All project code is written during DubHacks '26, in this repository, to the contracts in ARCHITECTURE.md.

---

## Person 1: AI brain

**Goal.** Everything Gemini does, behind the server. Nobody else calls Gemini or writes prompts.

**Owns.** All of `server/` except `server/zoom.js`. That is `index.js`, `sockets.js`, `rooms.js`, `errors.js`, `gemini.js`, `prompts.js`, `cues.js`, `transcriber.js`. Also `scripts/`, `package.json` and `.env.example`.

**Build, in this order.**

1. **Mock mode, first hour.** When `MOCK_GEMINI=1` is set in `.env`, every function in `gemini.js` returns realistic canned data after a short delay: slide descriptions, a deck, transcript lines, an occasional nudge, Q&A answers. This lets Persons 3 and 4 work without keys or quota. Push it before anything else.
2. **Screenshot descriptions.** `POST /api/rooms/:id/frame` takes the cropped JPEG from the listener page. With no deck, Gemini describes it. With a deck, Gemini matches it to a page. Describe at most once every 3 seconds per room. If frames arrive faster, describe only the newest. Broadcast the result as a `slide` message.
3. **Deck processing and Q&A.** PDF upload to per-slide title, text, visuals and overview. Q&A over the deck, the current slide and recent transcript.
4. **Transcription.** 6-second chunks of the PCM audio the listener page streams. Skip silent chunks.
5. **Presenter cues.** Every 15 seconds, classify the last minute of transcript plus the current slide into one of `visuals`, `share-file`, `self-description`, or nothing. Feed dismissed cues back into the prompt so it doesn't repeat itself. Only check for `self-description` in the first five minutes or when someone introduces themselves.
6. **Stretch.** Gemini text-to-speech audio for each slide overview at upload time. Context caching for Q&A.

**Provides.** Every HTTP route and WebSocket message in ARCHITECTURE.md.

**Uses.** Frames and audio from the listener page, which Person 3 wires up from Person 2's modules. Presenter responses from Person 4's page.

**Test alone.** `npm run try -- slide.png "prompt"` for prompts. `curl` with a saved screenshot, PDF or WAV file. Mock mode for everything else.

**Done when.** A real meeting produces a description for each new slide within 4 seconds, a readable transcript, and at least one sensible cue, with no Gemini errors in the server log.

---

## Person 2: Live audio

**Goal.** Control everything the listener hears from the meeting, and notice slide changes and silence instantly, all in the browser.

**Owns.** `public/js/audio-engine.js`, `public/js/capture.js`, `public/js/worklets/`, and a new test page, `public/audio-lab.html` with `public/js/audio-lab.js`.

**Build, in this order.**

1. **Prove capture, first two hours.** In a real Zoom web client call, on a Mac and on a Windows laptop: capture the tab with audio, silence the Zoom tab with `suppressLocalAudioPlayback`, and pass the audio through our page. If this fails on either machine, tell the team immediately.
2. **Pause and catch up.** One continuous recording while held. Playback with no clicks or gaps. Accurate `secondsBehind` and `meetingTime`, which is the moment the audio now playing was originally spoken.
3. **Silence skipping and speed ramp.** Skip pauses longer than about 300 milliseconds. Speed starts at 1.25x and rises toward `maxRate` as the backlog grows. Pitch stays natural.
4. **Presenter-quiet detection.** Fire once per silence longer than 2 seconds, only while the listener isn't hearing live audio.
5. **Slide watching.** Crop to the shared-content area so camera tiles don't count. Fire `onChange` once the screen has changed and held still for about a second.
6. **Audio for transcription.** `streamPcm` sends 16 kHz audio of the live meeting in every mode.

**Never.** Play earcons, speak, call the server, or touch the listener page. You emit events. Person 3 decides what the listener hears.

**Provides.** `startCapture`, `watchSlides` and `MeetingAudio`, exactly as specified under "Browser modules" in ARCHITECTURE.md.

**Uses.** Nothing from other lanes.

**Test alone.** The audio lab page: buttons for hold, catch up and skip to live, and a live readout of mode, seconds behind and meeting time. Any tab with talking in it, such as a YouTube lecture, works as a source.

**Done when.** In a real call on both operating systems, holding for 30 seconds and catching up gets back to live with no audible glitches. Slide changes fire within about a second, and moving camera tiles don't fire them.

---

## Person 3: Listener experience

**Goal.** Decide what the listener hears and when, and make the listener page excellent with a screen reader and keyboard alone.

**Owns.** `public/listener.html`, `public/js/listener.js`, `public/js/speech.js`, `public/js/earcons.js`, a new `public/js/settings.js`, `public/css/styles.css`, `public/index.html`, `public/js/home.js`, `public/js/common.js`, `public/js/socket.js`.

**Build, in this order.**

1. **Announcement queue.** All speech and screen reader announcements go through `speech.js`. Nothing speaks over a slide description. During a description the earcon plays and the words wait. Alt+Shift+A repeats the last alert.
2. **Wire up the audio engine.** Describe, back to presenter, skip to live, and a status line saying live, paused or catching up and how far behind.
3. **Slide changes.** Follow the rules under "What the listener hears" in ARCHITECTURE.md: knock on the local change, post the frame, update the content silently when the description arrives.
4. **Speaker names.** A field for the Zoom meeting link. Person 4's helper sends speaker events. Announce names following the timing rules in ARCHITECTURE.md.
5. **Settings.** On by default, each one can be turned off: every earcon, speaker names, slide titles. Also voice speed, catch-up speed cap, built-in voice or own screen reader. Saved in the browser.
6. **Every shortcut** in the PRODUCT.md table, including Alt+Shift+H to hear them all.
7. **Slide review and Q&A** screens.
8. **Screen reader pass.** VoiceOver on Mac and NVDA on Windows, keyboard only, monitor off, before the Sunday morning run-through. Check that Alt+Shift doesn't switch keyboard language on Windows.

**Provides.** `speech.js`, `earcons.js` and `settings.js` as specified in ARCHITECTURE.md. Person 4's presenter page may import them but doesn't change them.

**Uses.** Person 2's capture and audio engine. Person 4's Zoom helper. Person 1's routes and messages.

**Test alone.** Mock Gemini mode gives slides, descriptions and transcript without a key. Person 2's audio lab shows the engine on its own.

**Done when.** A screen reader user can do the whole demo flow without the mouse, and never hears two voices at once.

---

## Person 4: Presenter, Zoom and demo

**Goal.** The presenter's side of the product, speaker names from Zoom, and a demo that works on stage.

**Owns.** `public/presenter.html`, `public/js/presenter.js`, a new `public/css/presenter.css`, a new `public/js/zoom-helper.js`, a new `server/zoom.js`, a new test page `public/zoom-lab.html` with `public/js/zoom-lab.js`, and `docs/DEMO.md`.

`server/index.js` belongs to Person 1. Person 4 adds exactly one import line and one line mounting `zoomRouter` at `/api/zoom`, once, in their first pull request.

**Build, in this order.**

1. **Zoom app, first hour.** Create a General app on the Zoom Marketplace with the Meeting SDK turned on, using the same Zoom account that will host the demo meeting. Put its keys in `.env` as `ZOOM_SDK_KEY` and `ZOOM_SDK_SECRET`. The `@zoom/meetingsdk` package is approved for this lane.
2. **Zoom lab.** `server/zoom.js` signs the join token with Node's built-in crypto, no extra package. The lab page joins a team-hosted meeting as "Accessibility helper" and logs every SDK event. It must answer two questions, and the answers go in docs/DECISIONS.md:
   - Do active-speaker events arrive with display names, and is there a screen-sharing event?
   - If the listener joins only through the SDK inside our page, can we mute the SDK's own sound and still capture the meeting audio? If yes, the team can switch to one tab with no Zoom web client.
3. **Zoom helper module.** `zoom-helper.js`, exactly as specified under "Browser modules" in ARCHITECTURE.md.
4. **Presenter page.** Cue cards labeled with the cue type and whether it came from the AI or a listener request. Notifications and vibration. PDF upload. Manual previous and next slide controls.
5. **Demo.** A deck with a chart, a photo and a dense text slide. The script in DEMO.md. A backup screen recording. The pitch.
6. **Then help Person 2.** Pair on whatever is riskiest in live audio.

**Provides.** `zoom-helper.js` and `POST /api/zoom/signature`.

**Uses.** Person 1's routes and messages. Person 3's `speech.js` and `earcons.js` for presenter alerts.

**Test alone.** The Zoom lab page, and mock Gemini mode for the presenter page.

**Done when.** The listener page announces the right name within 2 seconds of someone starting to talk in a team-hosted meeting. A nudge reaches the presenter's phone, and the demo runs start to finish twice in a row.

---

## How it comes together

| What flows | From | Through | To |
|---|---|---|---|
| Meeting audio for transcription | Person 2's `streamPcm` | Person 3 sends it on the WebSocket | Person 1's transcriber |
| Slide change | Person 2's `watchSlides` | Person 3 plays the knock and posts the frame | Person 1 describes it |
| Slide description | Person 1 | `slide` and `deck` messages | Person 3 shows and speaks it |
| Pause, catch-up, quiet room | Person 2's `MeetingAudio` events | | Person 3 plays sounds and updates status |
| Speaker names | Person 4's `zoom-helper.js` events | Person 3 times them against `meetingTime` | the listener |
| Presenter cue | Person 1's cue check | `nudge` message | Person 4's card, then `respond` back to Person 1 |
| Listener request | Person 3 | `request-description` message, through Person 1's server | Person 4's card |
| Presenter's answer | Person 4 | `respond`, then `presenter-response` | Person 3 announces it |
| Deck | Person 4's upload | Person 1 processes it | `deck` message to Person 3 |
| Questions | Person 3 | `POST /ask` | Person 1 |

## Checkpoints

Check the official DubHacks schedule. Last year's pattern was submissions due Sunday at 10:30 a.m. and judging from 11:30 a.m.

| When | What |
|---|---|
| Saturday kickoff, 30 minutes | Fill in names. Read this file together. Confirm the contracts. Decide whether to rebuild the code. |
| Saturday, first two hours | Person 1: mock mode merged. Person 2: capture proven on both machines. Person 3: announcement queue and settings. Person 4: Zoom lab answers both questions. |
| Saturday, about 6 p.m. | **Integration 1.** One laptop, the full flow, real Gemini, real meeting. Write down every bug. |
| Saturday night | Lanes feature-complete. |
| Sunday, about 7 a.m. | **Integration 2.** The full demo script, twice. Screen reader pass. |
| Sunday, about 9 a.m. | **Code freeze.** Only fixes for bugs that appear in the demo. |
| Sunday, before submissions close | Submit. Record the backup video if it's not done. |

## Stretch work

Nobody owns these until their own lane is done. Claim one in the team chat before starting.

- Match frames to PDF pages locally with pdf.js thumbnails instead of Gemini. Needs the team's OK for the dependency.
- Gemini text-to-speech audio for slide overviews.
- Gemini Live API for faster transcription.
- Export the transcript and slide descriptions to a Google Doc after the meeting.
- Pull lecture slides from Canvas or Google Classroom.
- A tiny Chrome extension that toggles Zoom's mute from anywhere.
