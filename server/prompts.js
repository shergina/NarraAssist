// Owner: Person 1. Every Gemini prompt lives here.
//
// Rules for every prompt: say who it's for, write for the ear, use only the material given,
// and never invent slides, numbers or text. If there is nothing to answer from, say so.
// Output shapes are enforced by the JSON schemas in gemini.js, so prompts describe fields, not formatting.

export const SPOKEN_RULES = `Rules for visuals and overview: what someone would hear instead of seeing the slide. Prefer
the slide's own words. If the slide has little text, the overview is
that text read in order, plus a short description of any meaningful
visual. Paraphrase only to shorten dense text or to summarize a chart,
and then give the main point first and the most important number. Keep
it under about sixty words. Start directly with the content. Do not
begin with phrases like "This slide shows", and do not repeat the title.
If the slide is only a title, the overview is the subtitle or presenter
name if there is one, plus the visuals.

${SPOKEN_RULES}`;
