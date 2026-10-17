# Decisions

One line per decision, newest at the bottom, with the reason. Add to it when the team settles something. Dates are 2026.

| Date | Decision | Why |
|---|---|---|
| Oct 13 | Web app, not a Chrome extension or native app | Presenter needs a web page anyway, nothing to install for judges, one codebase for Mac and Windows. An extension is the long-term listener product. |
| Oct 13 | The listener uses Zoom's web client in Chrome; everyone else uses the normal Zoom app | Chrome tab capture gives us slides and audio with no native code. `suppressLocalAudioPlayback` lets our page control everything the user hears. |
| Oct 13 | Gemini for all AI: deck reading, descriptions, transcription, cues, Q&A, speaker names | Encouraged by the hackathon, and one SDK for everything. |
| Oct 14 | Plain JavaScript everywhere, no TypeScript, no framework, no build step | The browser side has to be JS. One language for four people. Nothing to break on Windows at 2 a.m. |
| Oct 14 | Node server, not Python | Same language as the browser, and Python on Windows costs hours. If a teammate only knows Python, the server can be swapped; the contract is JSON. |
| Oct 14 | Working without a PDF is the main mode; the uploaded deck is a bonus | The listener should not depend on the presenter doing anything. |
| Oct 14 | The slide-change knock is decided locally and instantly; Gemini never gates it | The sound must be immediate and reliable. Descriptions arrive a few seconds later. |
| Oct 14 | Describe each new slide in the background as soon as the knock fires | So "describe" is instant instead of a three-second wait. |
| Oct 14 | With a deck, match frames to PDF pages locally with pdf.js thumbnails; Gemini matching is the no-deck fallback | Instant, free, works offline. |
| Oct 14 | Catch-up skips silences longer than ~300 ms and scales speed from 1.25x toward a 2x default cap, user-adjustable to 2.5x | Skipping pauses catches up faster than raw speed and sounds natural. Past 2.5x an unfamiliar voice is unintelligible. |
| Oct 14 | Rebuild recording as one continuous stream appended to a Media Source buffer, not rotating segments | Removes glitches at segment seams and gives an exact "seconds behind". |
| Oct 14 | Transcription stays chunked (6 s to Gemini) for now; Live API only if time allows | Simple and deterministic. Cues only run every 15 s anyway. |
| Oct 14 | ~~Speaker names come from Zoom display names, read off the highlighted tile in a cropped frame by Gemini~~ Replaced on Oct 16, see below. Kept as the fallback. | Captured audio is mixed, so names have to come from the screen. |
| Oct 14 | Names are announced only while hearing the speaker; during catch-up at the moment playback reaches them | A name must match the voice being heard. |
| Oct 14 | Every earcon and announcement is on by default and can be turned off individually in settings | User control, sensible defaults. |
| Oct 14 | Presenter sees whether a cue came from the AI or from a listener request | Trust: the presenter should know a person asked. |
| Oct 14 | Presenter cues: describe visuals, share the file, describe yourself. Dismissed cues are fed back into the prompt | Keeps the AI from repeating itself. |
| Oct 14 | Spoken slide overviews are generated with Gemini TTS at upload time and cached | Instant and good-sounding in the demo. Browser voice is the fallback. |
| Oct 14 | AGENTS.md is the one instructions file; CLAUDE.md and GEMINI.md just include it | Teammates use different AI tools. Symlinks misbehave in git on Windows. |
| Oct 14 | Build order: catch-up audio on both platforms, local slide detection, deck processing with cached speech, presenter cues, then speaker names, settings, screen reader pass, demo | The first two are the demo-critical risks. |
| Oct 14 | Test the Alt+Shift shortcuts with NVDA on day one | Alt+Shift switches keyboard language on Windows when several are installed. Change the modifier if it bites. |
| Oct 16 | Speaker names come from the Zoom Meeting SDK for web. The listener page joins the same meeting as a visible participant named "Accessibility helper" and listens for active-speaker events with display names | One event listener instead of reading names off screenshots. Audio and slides still come from tab capture, so the riskiest code is untouched. |
| Oct 16 | The demo meeting is hosted by a team member's Zoom account | Since March 2, 2026, Meeting SDK apps that haven't passed Zoom's review can only join meetings hosted by their own account. |
| Oct 16 | In the pitch, say plainly that this is a prototype on a team-hosted meeting; production goes through Zoom Marketplace review, and the long-term design is Zoom Realtime Media Streams | Honest about limits, and shows we know the production path. Point out the helper participant before anyone asks. |
| Oct 16 | First task Saturday for person 4: one hour to prove the SDK helper reports active speakers in a team-hosted meeting. If it doesn't, fall back to the screenshot approach | Time-box the unknown. |
| Oct 16 | Gemini stays the AI provider even though it isn't on the DubHacks resource list. Ask an organizer whether Google Cloud credits cover Gemini through Vertex AI | The list is suggestions, not rules. Vertex AI is a small code change if needed. |
| Oct 16 | Work is split by layer, not by feature, into four lanes described in docs/ROLES.md | Features cut across AI, audio, listener and presenter. Layers keep each file with one owner, so merges don't conflict. |
| Oct 16 | Earcons and settings move from Person 2 to Person 3. Only Person 3's code plays sounds or speaks on the listener page; other modules emit events | Person 2 has the hardest work. One place decides what the listener hears, which is how "never talk over a description" stays true. |
| Oct 16 | Person 1 owns every server file except server/zoom.js. Person 4 adds one mount line to server/index.js, once | One owner per file. |
| Oct 16 | Mock Gemini mode is the first thing Person 1 ships | Persons 3 and 4 can build without a key or quota. |
| Oct 16 | The listener pastes the Zoom meeting link on the listener page for speaker names | The listener shouldn't depend on the presenter doing anything. |
| Oct 16 | `@zoom/meetingsdk` is an approved dependency for Person 4; the join token is signed with Node's built-in crypto | Needed for the helper. No extra token library. |
| Oct 16 | Person 4's Zoom lab also tests whether the listener can join only through the SDK with its sound muted; if so, switch to one tab | One tab is a much better product, but only if our audio control survives. |
| Oct 17 | Start from a shared skeleton: every file exists with its owner, stubs follow the contracts, and the app runs end to end with mock data | Four AI agents starting from an empty repo would each invent their own layout. A skeleton fixes the structure before real work starts. |
| Oct 17 | Mock Gemini is the default in `.env.example`; Person 1 switches to live | Everyone can run the app the moment they clone it. |
| Oct 17 | The listener page has a Developer tools panel that simulates the other lanes | Each lane can test its own work without waiting for the others. |
| Oct 17 | `server/zoom.js` is mounted from the start | Person 4 never has to edit Person 1's files. |
| Oct 17 | Screenshots and the PDF both use the main model (Flash), not Flash-Lite | Flash-Lite was 2 s faster but, on repeated runs, miscounted the people in a photo every time and leaked the title into the spoken text. With the model's thinking turned off it takes about 2.5 s, as fast as Flash-Lite, and stayed accurate on repeated runs. |
| Oct 17 | "Describe" reads the slide word for word with image descriptions inserted in reading order, marked "Image:" and similar. No summarizing by default | The listener should hear exactly what is on the slide. A paraphrase can drift, and the listener can't check it. |
| Oct 17 | A shorter summary mode is a later optional setting, off by default | For speed on dense slides, chosen by the user, never silently. |
