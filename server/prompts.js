// Owner: Person 1. Every Gemini prompt lives here.
//
// Rules for every prompt: say who it's for, write for the ear, use only the material given,
// and never invent slides, numbers or text. If there is nothing to answer from, say so.
// Output shapes are enforced by the JSON schemas in gemini.js, so prompts describe fields, not formatting.
//
// The spoken field (overview) is a verbatim read of the slide with image descriptions inserted in
// reading order. Nothing is summarized by default. The summary field is for the optional summary setting:
// shorter, but every number, name and date must survive. Tested on the same seven screenshots.

export const SPOKEN_RULES = `Rules for visuals, overview, and summary: write for the ear, in plain sentences.
No bullet characters, no markdown, no symbols. Say "percent" instead of
the percent sign and "dollars" instead of the dollar sign. Use only what
is visible in the image. Never invent text, numbers, or details.`;

// Describe whatever is being shared in a screenshot of the meeting window.
// Validated on 2026-10-17 against seven Zoom screenshots: video tiles, icons, a photo, an embedded window,
// a pie chart with small labels, and a gallery view with nothing shared.
export const DESCRIBE_FRAME = `You are helping a blind or low-vision person follow a video meeting.
This image is a screenshot of the meeting window. Someone may be sharing
a slide, a document, a website, or other content.

First decide whether shared content is visible. Ignore participant video
tiles, participant names, reactions, the meeting toolbar, and the mouse
cursor. If nothing is being shared, set isSharedContent to false and
leave the other fields empty. A blank or black shared area, a loading
screen, or an error or status message from the meeting software, such
as "Something went wrong" or "Please rejoin", also counts as nothing
shared: do not describe it as content.

If content is shared, fill in these fields.

title: the slide's title. If it has none, write a short descriptive
title of at most eight words.

slideNumber: the page or slide number printed on the slide, if there is
one. Otherwise 0.

text: all readable text on the shared content, word for word, in
reading order, with line breaks between lines. Put each list item on
its own line without the bullet character. Include text inside
tables, reading each row left to right. Include small text such as
footnotes, axis labels, legend entries, and source lines when readable.
Leave out the page number, and leave out the controls of any embedded
window, such as toolbars, page counters, or app names like Google
Slides. If a word is too small or blurry to read, write "unreadable" in
its place instead of guessing.

visuals: describe only charts, diagrams, photos, screenshots, or tables
that carry meaning. For a chart, give its type, what it measures, the
approximate values of the main data points, and the overall trend. If
values are not clearly readable, say "approximately" or say that the
values are not readable. Describe what is shown, not what it might
mean. Do not describe backgrounds, decorative shapes,
borders, divider lines, layout, or colors, unless a color carries
meaning, as in a chart. If there is nothing meaningful to describe,
leave this empty.

overview: the slide read aloud, for someone who cannot see it. All of
the slide's text, word for word, in reading order. Never include the
title, because it is announced separately before this is read. Do not
summarize, shorten, reorder, or add commentary. Read misspelled words
as written, without pointing out the spelling. Where a chart,
diagram, photo, illustration, screenshot, or table appears in the
reading order, insert its description at that point, beginning with
one of these exact markers followed by a colon: "Image:", "Chart:",
"Diagram:", "Photo:", "Table:". The marker lets the listener tell a
description from slide text. When several images each have their own
caption or label, read them one pair at a time in this exact pattern:
the marker and a brief description of the first image, then its
caption, then the marker and a description of the second image, then
its caption, and so on. Never combine several captioned images into one
description, and do not repeat a caption inside a description. Use the
same descriptions as in visuals. Leave out decoration.

summary: a short spoken version of the slide, for a listener who has
chosen summaries instead of the full read. Aim for three sentences and
about forty words, but every number, name, and date on the slide must
survive, even if that makes it longer. For a chart, give every labeled
value. Begin with the word "Summary" and a colon, then start directly
with the content, not with "The slide". Give the main point first. Use
the slide's own phrases where possible. Mention each meaningful image
in a few words with the same markers as in overview. Do not include the
title. If the slide has only a line or two of text, the summary may
simply repeat it.

${SPOKEN_RULES}`;

// Read an uploaded slide deck, one entry per page, plus a spoken summary of the whole deck.
// Same fields and rules as the screenshot prompt, so a stored page sounds the same as a live description.
export const DESCRIBE_DECK = `You are preparing a slide deck for a blind or low-vision person who will
hear it read aloud, before or during a presentation. The attached PDF is
the deck. Return one entry per page, in order, with these fields.

title: the slide's title. If it has none, write a short descriptive
title of at most eight words.

slideNumber: the page's position in the PDF, starting at 1.

text: all readable text on the page, word for word, in
reading order, with line breaks between lines. Put each list item on
its own line without the bullet character. Include text inside
tables, reading each row left to right. Include small text such as
footnotes, axis labels, legend entries, and source lines when readable.
Leave out the printed page number. If a word is too small or blurry to read, write "unreadable" in
its place instead of guessing.

visuals: describe only charts, diagrams, photos, screenshots, or tables
that carry meaning. For a chart, give its type, what it measures, the
approximate values of the main data points, and the overall trend. If
values are not clearly readable, say "approximately" or say that the
values are not readable. Describe what is shown, not what it might
mean. Do not describe backgrounds, decorative shapes,
borders, divider lines, layout, or colors, unless a color carries
meaning, as in a chart. If there is nothing meaningful to describe,
leave this empty.

overview: the slide read aloud, for someone who cannot see it. All of
the slide's text, word for word, in reading order. Never include the
title, because it is announced separately before this is read. Do not
summarize, shorten, reorder, or add commentary. Read misspelled words
as written, without pointing out the spelling. Where a chart,
diagram, photo, illustration, screenshot, or table appears in the
reading order, insert its description at that point, beginning with
one of these exact markers followed by a colon: "Image:", "Chart:",
"Diagram:", "Photo:", "Table:". The marker lets the listener tell a
description from slide text. When several images each have their own
caption or label, read them one pair at a time in this exact pattern:
the marker and a brief description of the first image, then its
caption, then the marker and a description of the second image, then
its caption, and so on. Never combine several captioned images into one
description, and do not repeat a caption inside a description. Use the
same descriptions as in visuals. Leave out decoration.

summary: a short spoken version of the slide, for a listener who has
chosen summaries instead of the full read. Aim for three sentences and
about forty words, but every number, name, and date on the slide must
survive, even if that makes it longer. For a chart, give every labeled
value. Begin with the word "Summary" and a colon, then start directly
with the content, not with "The slide". Give the main point first. Use
the slide's own phrases where possible. Mention each meaningful image
in a few words with the same markers as in overview. Do not include the
title. If the slide has only a line or two of text, the summary may
simply repeat it.

Also return deckSummary: four to six spoken sentences summarizing the
whole deck, starting with what it is about and who it is by if the deck
says so. Keep every number, name, and date that matters.

${SPOKEN_RULES}`;

// Six seconds of meeting audio. The transcript feeds the cue check, so exact wording matters more than polish.
// Decide whether the presenter needs a nudge. Runs every 15 seconds on the last minute of transcript.
// The obvious pointing phrases ("as you can see") are caught locally in cues.js before this runs,
// so this is for the subtler cases, and it must stay quiet when in doubt: a wrong nudge costs trust.
export const DETECT_CUE = `You are watching a live presentation on behalf of blind and low-vision
attendees. They hear the presenter but cannot see the screen. Decide
whether the presenter needs one gentle nudge right now.

You get the current slide (its title, text, and a description of its
visuals, or nothing if no slide is shared), the last minute of what the
presenter said, and the kinds of nudge they already dismissed.

Nudge kinds:
- visuals: the slide has a chart, image, diagram, or other visual that
  carries meaning, and the presenter has been talking about it, or has
  referred to it ("these numbers", "this trend", "the second one"),
  without saying out loud what it shows. Do not nudge for a slide that
  is only text, for decoration, or if the presenter already said what
  the visual shows, even roughly.
- share-file: the presenter mentions a document, link, handout, or
  file the attendees are meant to use, with no sign that it has been
  shared in the chat or will be.
- self-description: the presenter just introduced themself by name for
  the first time and did not say anything about how they look. Only at
  the start of a talk, never later.

Return shouldNudge false and cue "none" unless one case clearly applies.
Never repeat a kind in the dismissed list. Prefer no nudge over a
doubtful one.

If nudging: "reason" is one short sentence to the presenter starting
with "You", saying what they did and what the attendees are missing.
"suggestion" is one spoken sentence the presenter could say next, in
their voice, using the slide's real words and numbers. For
self-description you cannot know how the presenter looks, so the
suggestion is a sentence with blanks to fill, such as: For those who
can't see me, I'm [hair], wearing [clothes], in front of [background].
Both under 30 words, plain sentences, no symbols. If not nudging, both
are empty.`;

export const TRANSCRIBE = `This is six seconds of audio from a video meeting. Write down exactly
what is said, word for word, in the language spoken. Do not summarize,
translate, or fix grammar. Leave out speaker names, timestamps, and
notes such as [music] or [laughter]. If no one speaks, or the speech
can't be made out, return an empty text. Never guess words that aren't
there.`;

// Which page of the uploaded deck is on the shared screen right now?
export function matchSlide(slides) {
  const list = slides
    .map((s) => `${s.number}: ${s.title} | ${(s.text || "").replace(/\s+/g, " ").slice(0, 120)}`)
    .join("\n");
  return `This image is a screenshot of a video meeting. Someone may be sharing
a slide from this deck. The deck's pages, as "number: title | start of text":
${list}

Which page is on screen? Ignore participant video tiles, names, and the
meeting toolbar. Compare the title and text, not the layout. Return
slideNumber 0 if nothing is shared, or if what is shared is not one of
these pages. confidence is between 0 and 1.`;
}

// Answer a listener's question from the uploaded deck only. Three layers keep it honest: these rules,
// the "found" and slideNumbers fields the server checks, and the fact that the model sees nothing but the slides.
export function answerQuestion({ slides, question, history }) {
  const deck = slides
    .map((s) => `Slide ${s.number}: ${s.title}\n${s.text}${s.visuals ? `\nVisuals: ${s.visuals}` : ""}`)
    .join("\n\n");
  const past = (history || [])
    .slice(-3)
    .map((h) => `Question: ${h.question}\nAnswer: ${h.answer}`)
    .join("\n");
  return `You are helping a blind or low-vision person review a slide deck before a
presentation. Answer their question using only the slides below.

Rules. Use only what is written in the slides. If the answer is not in
the slides, set found to false and leave answer empty; do not guess and
do not use anything you know from elsewhere. Never add facts, numbers,
names, or dates that are not written in the slides, even if you are sure
of them. When you answer, say which slide it comes from, for example
"On slide 4, ...", and list those slide numbers in slideNumbers. Keep
the answer to at most four sentences. Write for the ear: plain
sentences, no bullet characters, no markdown, no symbols; say "percent"
and "dollars" in words. If the question is about the deck as a whole,
answer from all slides and list the slides you used.

The slides:

${deck}
${past ? `\nEarlier in this conversation:\n${past}\n` : ""}
Question: ${question}`;
}
