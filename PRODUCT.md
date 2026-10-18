# Product goal

DubHacks 2026 project. This file describes what the finished product should do and feel like. It is the source of truth for scope. If code and this file disagree, this file wins until the team changes it.

## The problem

Blind and low-vision people use a screen reader to read anything on screen. In a video meeting with shared slides, that means listening to two voices at once: the presenter and the screen reader reading the slide. Nobody can follow both, so they end up missing the slide, the talk, or both.

Presenters make it worse without meaning to. They say "as you can see here", point at charts, share files only on screen, and introduce themselves without describing what attendees can't see.

## The goal

A blind or low-vision attendee can follow a Zoom presentation as well as a sighted attendee. They never have to listen to two things at once. They can step away to hear a slide described, and then catch up on what they missed without losing the thread. Presenters get gentle, real-time help to make their talk accessible in the first place.

## Who it's for

- **Listener.** A blind or low-vision meeting attendee who uses a screen reader such as VoiceOver, NVDA or JAWS. Uses the keyboard, not the mouse.
- **Presenter.** The person sharing slides. Uses the normal Zoom app and keeps our presenter page open on a phone or second screen.

## Product shape

- A web app with two pages: one for the listener and one for the presenter. Each meeting gets its own room code.
- The listener joins Zoom in Chrome with "Join from your browser" and connects our page to that tab. Everyone else uses Zoom as usual.
- It works the same on macOS and Windows.

## Features

### 1. Presenter cues

The presenter page sends a push notification when the presenter could make the talk more accessible. Each cue says what triggered it and suggests a sentence to say.

The app cues the presenter to:

- **Describe visuals.** They referred to something visual without saying what it is, such as "as you can see", "this chart", or "look at the numbers here".
- **Share files individually.** They showed a document, link or file only on screen. Suggest dropping a link in the chat so attendees can open their own copy.
- **Describe themselves.** They introduced themselves without a short self-description, such as "I'm a woman with short dark hair, wearing a blue shirt."

Mistakes are expected, so both directions have an escape hatch:

- **Unneeded cue.** The presenter can accept it ("I'll describe it") or dismiss it ("Not needed"). Dismissals are logged so the team can tune the prompts.
- **Missed cue.** The listener can send a manual request, with an optional note such as "What's in the chart?"
- The presenter always sees where a cue came from: the AI, or a request from a listener.
- The listener hears when the presenter accepts or declines a request.

### 2. Slides before the meeting

- The presenter uploads the slides as a PDF before the meeting.
- The listener can review the slides on their own, slide by slide, as screen-reader-friendly text. Charts, images and tables come with written descriptions.
- The listener can hear an AI summary of the whole deck, or of one slide.
- The listener can ask questions about the slides and the talk, before or during the meeting, and get short spoken-style answers. Powered by the Gemini API.

### 3. Live slide explainer

- The listener can pause the presenter at any time and hear an audio overview of the current slide.
- While the overview plays, the presenter's audio is recorded, not lost.
- When the overview ends, the listener hears what they missed at a faster speed, with natural pitch, until they are back to live.
- The listener can switch back and forth between the description and the presenter whenever they want, and can jump straight to live.
- The listener always knows where they are: live, paused, or catching up, and how far behind.
- The listener is told when the slide changes.
- If the presenter stops talking while the listener is paused or catching up, the listener is told right away, in case someone is waiting for them to answer.

### 4. Audio cues

Short, distinct sounds for events, so the listener doesn't need to hear words to know what happened.

| Event | What the listener hears |
|---|---|
| Slide changed | A soft wooden knock or subtle chime |
| Presenter stopped talking | A short falling tone. The room is quiet or waiting for them to unmute. |
| Catch-up complete | A rising two-tone sweep. They are back to live. |
| New speaker | The name of the person who started talking, spoken briefly |

Sounds and announcements must never talk over a slide description. If something happens during a description, the sound plays and the words wait or can be repeated with a shortcut.

Speaker names:

- The name comes from the person's Zoom display name.
- Names are announced only while the listener is hearing the speaker, live or catching up. During a slide description, no names are announced.
- When the listener goes back to the speaker, they hear the name of whoever is talking. While catching up, names are announced as each person's speech plays back, not when it happened live.

All sounds and announcements are on by default. The listener can turn each one off in settings.

### 5. Keyboard shortcuts for everything

Every action has a keyboard shortcut. Shortcuts must not clash with VoiceOver, NVDA or JAWS. The listener can hear a list of shortcuts at any time.

Draft shortcuts for the listener page:

| Action | Shortcut |
|---|---|
| Describe the slide, or go back to the presenter | Alt+Shift+D |
| Skip straight to live | Alt+Shift+L |
| Ask the presenter to describe something | Alt+Shift+R |
| Repeat the last alert | Alt+Shift+A |
| Say who is speaking | Alt+Shift+W |
| Say the current slide's title and number | Alt+Shift+S |
| Read the full slide text, even when summaries are on | Alt+Shift+F |
| Ask a question about the slides | Alt+Shift+Q |
| Mute or unmute my microphone | Alt+Shift+M |
| Show or hide the floating Zoom video | Alt+Shift+V |
| Hear all shortcuts | Alt+Shift+H |

On a Mac, Alt is the Option key.

### 6. The app itself is fully accessible

- Every page works with VoiceOver on Mac and NVDA on Windows, keyboard only.
- Clear headings and landmarks so screen reader users can jump around.
- Every button and field has a clear label. Status changes are announced.
- High contrast, large text, visible focus, and both light and dark mode.
- Tested by a team member using a screen reader with the monitor off before demo day.

## What success looks like at the demo

1. The presenter uploads a deck. The listener hears a summary and asks a question about it.
2. The presenter starts talking. The listener hears who is speaking.
3. The slide changes. The listener hears the knock.
4. The listener pauses, hears the slide overview, and catches up at faster speed. They hear the rising sweep when back to live.
5. The presenter says "as you can see here". A cue appears on their phone, and they describe the chart.
6. The listener asks for a description of something the AI missed, and the presenter answers.
7. All of it is done with the keyboard and a screen reader.

## Implementation plan

The detailed wiring is in docs/ARCHITECTURE.md and the reasons in docs/DECISIONS.md. This is the short version.

### Shape

- A web app: two plain HTML pages and a Node server, all in plain JavaScript, no build step. Works the same on macOS and Windows.
- Two tabs: the Zoom tab is only for listening, our page is where the listener works. Our page also joins the meeting under the listener's name to carry their microphone, so they never switch tabs to talk. By default the Zoom video floats over other tabs as a small picture-in-picture window, which low-vision listeners can turn off.
- The listener joins Zoom with "Join from your browser" in Chrome and connects our page to that tab. Chrome hands us the slides and the audio, and stops the Zoom tab from playing sound itself, so our page controls everything the listener hears.
- The server holds the Gemini key and does all the AI work. The browser does everything that has to be instant.

### What each feature needs

| Feature | Where it runs | Gemini's part |
|---|---|---|
| Slide changed | Browser compares frames and plays the knock the moment the screen settles | None. Then describes the new slide in the background so a description is ready |
| Live slide explainer | Browser records the presenter while the description plays, then plays it back with silences skipped and speed rising toward a cap | Writes the description. With a deck, the spoken audio is pre-generated with Gemini TTS at upload |
| Slides before the meeting | Presenter uploads a PDF | Reads every page into text, visual descriptions and an overview, with structured output. Answers questions with the deck cached |
| Presenter cues | Server checks every 15 seconds | Classifies the last minute of transcript plus the current slide into: describe visuals, share the file, describe yourself, or nothing. Dismissed cues are fed back so it doesn't nag |
| Transcript | Browser streams 16 kHz audio, server sends 6-second chunks | Transcribes each chunk |
| Speaker names and mute | The listener page joins the meeting through the Zoom Meeting SDK under the listener's own name, microphone on and speaker off. It receives active-speaker events with display names and carries the listener's microphone, so mute is a shortcut on our page | None. Fallback if the SDK fails: Gemini reads the name off the highlighted tile, and the listener switches to the Zoom tab to talk |
| No deck uploaded | Same as above, minus the PDF | Describes the shared screen directly |
| Earcons, shortcuts, settings | Browser only | None |

### Build order

Day one: catch-up audio proven on a Mac and a Windows laptop in a real call, local slide detection, deck processing with cached speech, presenter cues.
Day one also: person 4 spends one hour proving the Zoom Meeting SDK helper reports active speakers in a team-hosted meeting.
Day two: speaker names, per-sound settings, a full pass with a screen reader and the monitor off, demo script and recording.

### Working as four people with AI tools

- AGENTS.md is the one instructions file, and CLAUDE.md and GEMINI.md include it, so every AI session starts from the same rules.
- Each person owns a set of files, listed in AGENTS.md. Nobody's AI edits another person's files without a message first.
- Message formats between the pages and the server are written down in docs/ARCHITECTURE.md before the code that uses them.
- Small pull requests merged within the hour, with `npm run check` run first.
- The demo meeting is hosted by a team member's Zoom account. Unreviewed Zoom SDK apps can only join their own account's meetings. In production the app goes through Zoom Marketplace review, and the long-term design is Zoom Realtime Media Streams, which sends audio, transcripts and speaker names straight to our server.
- Everyone needs Node.js 22 or newer, Chrome, and an editor such as VS Code, Claude Code or Gemini CLI. The daily loop is `npm run dev` and reload.
