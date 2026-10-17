// Owner: Person 1. Every Gemini prompt lives here.
//
// Rules for every prompt: say who it's for, write for the ear, use only the material given,
// and never invent slides, numbers or text. If there is nothing to answer from, say so.
// Output shapes are enforced by the JSON schemas in gemini.js, so prompts describe fields, not formatting.

export const SPOKEN_RULES = `Rules for visuals and overview: write for the ear, in plain sentences.
No bullet characters, no markdown, no symbols. Say "percent" instead of
the percent sign and "dollars" instead of the dollar sign. Use only what
is visible in the image. Never invent text, numbers, or details.`;

// Describe whatever is being shared in a screenshot of the meeting window.
// Validated on 2026-10-17 against five Zoom screenshots with video tiles, icons, a photo and an embedded window.
export const DESCRIBE_FRAME = `You are helping a blind or low-vision person follow a video meeting.
This image is a screenshot of the meeting window. Someone may be sharing
a slide, a document, a website, or other content.

First decide whether shared content is visible. Ignore participant video
tiles, participant names, reactions, the meeting toolbar, and the mouse
cursor. If nothing is being shared, set isSharedContent to false and
leave the other fields empty.

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
values are not readable. Do not describe backgrounds, decorative shapes,
borders, divider lines, layout, or colors, unless a color carries
meaning, as in a chart. If there is nothing meaningful to describe,
leave this empty.

overview: two to four sentences someone could listen to instead of
seeing the slide. Start directly with the content. Do not begin with
phrases like "This slide shows" or "This is a slide about". Give the
main point first, then the most important detail or number. Do not
repeat the title word for word.

${SPOKEN_RULES}`;
