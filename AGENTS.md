# Instructions for AI coding tools and new teammates

Read this first. It is short on purpose. Scope lives in PRODUCT.md, who builds what in docs/ROLES.md, the wiring in docs/ARCHITECTURE.md, and the reasons behind choices in docs/DECISIONS.md.

## What this is

A DubHacks 2026 web app that helps blind and low-vision people follow Zoom presentations. The listener captures their Zoom tab in Chrome. They can pause the presenter, hear a description of the slide, then catch up at faster speed. The presenter gets nudges to describe visuals. Gemini does the reading, describing, transcribing and judging.

## Run and check

```
npm install          once
npm run dev          server at http://localhost:3000, restarts on save
npm run check        syntax check of every JS file; run before every commit
```

Copy `.env.example` to `.env` and set `GEMINI_API_KEY`. Never commit `.env`.

## Who owns what

**Read [docs/ROLES.md](docs/ROLES.md) before writing code.** It has each person's exact brief, build order, and what they hand to and get from the others.

| Owner | Lane | Files |
|---|---|---|
| Person 1 | AI brain | everything in `server/` except `server/zoom.js`, plus `scripts/`, `package.json`, `.env.example` |
| Person 2 | Live audio | `public/js/audio-engine.js`, `public/js/capture.js`, `public/js/worklets/`, `public/audio-lab.html`, `public/js/audio-lab.js` |
| Person 3 | Listener experience | `public/listener.html`, `public/index.html`, `public/js/listener.js`, `public/js/home.js`, `public/js/speech.js`, `public/js/earcons.js`, `public/js/settings.js`, `public/js/common.js`, `public/js/socket.js`, `public/css/styles.css` |
| Person 4 | Presenter, Zoom, demo | `public/presenter.html`, `public/js/presenter.js`, `public/css/presenter.css`, `public/js/zoom-helper.js`, `public/zoom-lab.html`, `public/js/zoom-lab.js`, `server/zoom.js`, `docs/DEMO.md` |
| Everyone, through a pull request of its own | Contracts | `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `PRODUCT.md`, this file |

Do not edit another person's files. Message them instead. Change a contract in docs/ARCHITECTURE.md first, in its own pull request, then write the code.

## Rules

- Plain JavaScript ES modules in both the browser and Node. No TypeScript, no framework, no bundler, no build step.
- No new npm dependencies without asking the team. Current ones: `@google/genai`, `express`, `ws`. Approved for Person 4: `@zoom/meetingsdk`.
- Every Gemini call goes through `server/gemini.js`. Every prompt lives in `server/prompts.js`. Ask for structured JSON output with a schema, never parse free text.
- Model output goes into the page as text only. Use the `h()` helper or `textContent`. Never `innerHTML`.
- Anything the listener does must work with the keyboard alone and have a shortcut. Every control has a visible label or `aria-label`. Status changes go through `announce()` in `public/js/speech.js`.
- Nothing may speak over a slide description. Play the earcon, queue the words.
- Only Person 3's code plays sounds or speaks on the listener page. Other modules emit events.
- The slide-change knock is decided locally in the browser. Gemini is never in that path.
- The app must work with no PDF uploaded. The deck is an enhancement.
- Keep names plain. "Listener" is the blind or low-vision attendee, "presenter" is the speaker, "room" is one meeting.
- Line endings are LF. The repo enforces it. Don't fight it on Windows.

## Working together

- Branch from `main`, keep pull requests small, merge within the hour. Run `npm run check` first.
- When you change a message format, a route, or a shortcut, update docs/ARCHITECTURE.md.
- When you make a decision the team should know about, add a line to docs/DECISIONS.md.
- Test with a real screen reader: VoiceOver on Mac (Cmd+F5) or NVDA on Windows (free).

## Current state

No code yet. Everything is built during DubHacks '26, to the contracts in docs/ARCHITECTURE.md. The commands above work once Person 1 has added `package.json`.
