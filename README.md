# NarraAssist: A tool for virtual meeting accessibility for Blind and Low-Vision users

**Group Members Names:** Maria, Tanishka, Saanvi, Anika

**Dubhacks 2026**

**Status:** skeleton running with mock data. Features are built during DubHacks '26.

A hackathon prototype that helps blind and low-vision (BLV) people follow Zoom presentations.

Today a BLV attendee has to listen to the presenter and to their screen reader reading the slide at the same time. This tool lets them pause the presenter, hear a description of the slide, and then catch up on what they missed at faster speed. It also nudges the presenter to describe visuals out loud.

## Features

| Feature                   | How it works                                                                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slides before the meeting | The presenter uploads a PDF. Gemini turns every slide into text, chart descriptions and a short spoken overview. The listener can read them and ask questions.                                     |
| Describe, then catch up   | The listener presses a key. The presenter is muted and recorded while the slide overview is read. Then the recording plays at 1.75x speed, pitch preserved, until it reaches live.                 |
| Slide change alerts       | The listener's browser watches the shared screen. When it changes, Gemini matches it to a slide in the deck, and everyone gets a "slide changed" sound.                                            |
| Presenter stopped talking | While the listener is not hearing live audio, a falling tone plays if the room goes quiet, in case someone is waiting for them.                                                                    |
| Speaking-cue nudges       | Presenter audio is transcribed. Every 15 seconds Gemini checks whether the presenter said something like "as you can see here" without describing it, and nudges them. They can accept or dismiss. |
| Manual requests           | The listener can ask the presenter to describe the slide, with an optional note.                                                                                                                   |
| Earcons                   | A wooden knock for slide changes, a falling tone for silence, and a rising two-tone sweep when catch-up reaches live.                                                                              |

## How it fits together

```
 Zoom web client tab ──(Chrome tab capture: video + audio)──► Listener page
                                                               │  • plays meeting audio (live / paused / catch-up)
                                                               │  • detects screen changes, sends frames
                                                               │  • streams 16 kHz audio for transcription
                                                               ▼
                                    Node server (Express + WebSocket, one room per meeting)
                                                               │  • holds the Gemini key
                                                               │  • deck processing, slide matching, transcription, nudges, Q&A
                                                               ▼
                                                        Presenter page (phone or second screen)
```

The listener joins Zoom with "Join from your browser" in Chrome. Everyone else, including the presenter, can use the normal Zoom app. The listener page asks Chrome to share the Zoom tab. Chrome then stops that tab from playing sound itself, so the listener page controls everything the user hears. This is the same on macOS and Windows.

## Setup

You need Node.js 22 or newer and Google Chrome. The commands are the same on macOS and Windows.

```bash
git clone <this repo>
cd ZoomInSight
npm install
```

Copy the example settings file. It starts in mock mode, so the app runs with canned data and no key. For real Gemini calls, set `MOCK_GEMINI=0` and add a key from https://aistudio.google.com/apikey.

```bash
cp .env.example .env
```

On Windows Command Prompt use `copy .env.example .env` instead. Then edit `.env` and set `GEMINI_API_KEY`.

```bash
npm run dev
```

Open http://localhost:3000. The server restarts when you save a file. Rooms live in memory, so a restart clears them and you need to create a new room.

If the server warns that a model is not available, list the ones your key can use and set `GEMINI_MODEL` and `GEMINI_FAST_MODEL` in `.env`.

```bash
npm run models
```

## Hosting it (one server for everyone)

`render.yaml` is a Render blueprint: in Render choose New, then Blueprint, pick this repo, and enter the Gemini key when asked. The free plan sleeps after 15 minutes idle and loses saved decks on every deploy; the Starter plan plus a small disk (set `DATA_DIR=/var/data`) fixes both. Point a domain at the service under Settings, Custom Domains, and enter the records Render shows at the registrar.

## Testing with teammates or demoing

Each `npm run dev` is its own server with its own rooms, so two laptops can't share a room unless they use the same server. For team tests and the demo, one laptop runs the server plus a Cloudflare tunnel (`brew install cloudflared`, then `cloudflared tunnel --url http://localhost:3000`), and everyone uses the https address it prints. See docs/DEMO.md.

## Trying it

1. Open http://localhost:3000 and press **Create room**.
2. Open the **Presenter page** link, for example on your phone or in another window, and upload a PDF deck.
3. Open the **Listener page** link in Chrome.
4. Join a Zoom meeting in another Chrome tab using **Join from your browser**. Have someone share slides from the same deck.
5. On the listener page press **Connect to Zoom tab**. Pick the Zoom tab and turn on **Also share tab audio**.
6. Press **Alt+Shift+D** to hear the slide. Press it again, or wait for the description to end, to catch up.

Tips for a reliable demo:

- In Zoom, use the view where the shared screen fills the window. Moving video tiles can trigger extra slide checks.
- The presenter page has Previous, Next and Go to controls. Use them if automatic slide detection misses a change.
- Turn on notifications on the presenter page, and keep it open on a phone so nudges are visible while presenting.

### Listener keyboard shortcuts

| Keys        | Action                                          |
| ----------- | ----------------------------------------------- |
| Alt+Shift+D | Describe the slide, or go back to the presenter |
| Alt+Shift+L | Skip straight to live                           |
| Alt+Shift+R | Ask the presenter to describe the slide         |
| Alt+Shift+A | Repeat the last alert                           |

On a Mac, Alt is the Option key.

## Planned project layout

```
server/
  index.js          HTTP routes: rooms, deck upload, frame matching, Q&A
  sockets.js        WebSocket messages between listener and presenter pages
  rooms.js          in-memory room state
  gemini.js         every Gemini call
  prompts.js        every Gemini prompt, in one place for tuning
  transcriber.js    turns streamed audio into transcript chunks
  cues.js           decides when to nudge the presenter
public/
  index.html        create or join a room
  listener.html     the BLV attendee's page
  presenter.html    the presenter's page
  js/audio-engine.js         live, paused and catch-up audio, plus silence detection
  js/capture.js              Zoom tab capture and screen change detection
  js/worklets/pcm-worklet.js converts audio to 16 kHz for transcription
  js/earcons.js              alert sounds
  js/speech.js               built-in voice and screen reader announcements
  js/listener.js, presenter.js, home.js   page logic
scripts/
  list-models.js    npm run models
  check.js          npm run check, a syntax check that CI runs on macOS, Windows and Linux
```

Documents:

| File                   | What it is for                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `PRODUCT.md`           | What we are building and why. The source of truth for scope.                         |
| `AGENTS.md`            | Rules for AI coding tools and new teammates. `CLAUDE.md` and `GEMINI.md` include it. |
| `docs/ROLES.md`        | Who builds what, in what order, and how the lanes connect.                           |
| `docs/ARCHITECTURE.md` | Routes, WebSocket messages and shared objects. Update it with any change to them.    |
| `docs/DECISIONS.md`    | One line per decision and the reason.                                                |
| `docs/DEMO.md`         | The demo script.                                                                     |

## Team split

Each person's lane, build order and handoffs are in [docs/ROLES.md](docs/ROLES.md).

## Working together

- Branch from `main`, open a pull request, and let the check workflow pass before merging.
- Never commit `.env`. Each person uses their own Gemini key.
- Line endings are normalized to LF by `.gitattributes`, so Windows and Mac edits won't fight.
- Test the listener page with a real screen reader: VoiceOver on Mac (Cmd+F5) and NVDA on Windows, which is free.

## Known limitations

- The listener must use Chrome and the Zoom web client. Firefox and Safari can't capture tab audio.
- Leaving the listener page for Zoom is still needed to unmute, chat or raise a hand.
- PDFs over about 20 MB need the Gemini Files API, which is not wired up yet.
- Transcription runs in 6-second chunks, so nudges arrive a few seconds late.
- Meeting audio and slides are sent to Gemini. Tell attendees before using this in a real meeting.

## Where this could go next

- A Zoom App that runs inside the Zoom client, so nobody needs the web client.
- Zoom Realtime Media Streams for server-side audio and screen share without tab capture.
- Zoom's closed captioning API so the transcript also helps deaf and hard of hearing attendees.
- A small browser extension that adds a global "toggle Zoom mute" shortcut.
