// Owner: Person 1. Canned answers so everyone can build without a Gemini key.
// Shapes must match docs/ARCHITECTURE.md exactly, same as the real calls.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SLIDES = [
  {
    number: 1,
    title: "Welcome to ZoomInSight",
    text: "Following presentations without seeing the screen\nDubHacks 2026",
    visuals: "",
    overview: "Following presentations without seeing the screen. DubHacks 2026.",
    summary: "Summary: Following presentations without seeing the screen. DubHacks 2026.",
  },
  {
    number: 2,
    title: "Quarterly revenue",
    text: "Revenue by quarter, in millions of dollars",
    visuals: "A bar chart with four bars. Q1 is 2.1 million, Q2 is 2.4, Q3 is 3.0 and Q4 is 3.6. Each quarter is higher than the last.",
    overview: "Revenue by quarter, in millions of dollars. Chart: A bar chart with four bars. Q1 is 2.1 million, Q2 is 2.4, Q3 is 3.0 and Q4 is 3.6. Each quarter is higher than the last.",
    summary: "Summary: Revenue grew every quarter, from 2.1 million dollars in Q1 to 2.4, 3.0 and 3.6 million in Q4. Chart: a bar chart of the four quarters.",
  },
  {
    number: 3,
    title: "Meet the team",
    text: "Four students from the University of Washington",
    visuals: "A photo of four people standing in front of a whiteboard, smiling.",
    overview: "Four students from the University of Washington. Photo: four people standing in front of a whiteboard, smiling.",
    summary: "Summary: Four students from the University of Washington. Photo: the four of them in front of a whiteboard.",
  },
];

const LINES = [
  "Thanks everyone for joining today.",
  "As you can see here, the numbers went up a lot.",
  "Let's move on to the next part.",
  "I'll pause here for questions.",
];

let frames = 0;
let lines = 0;

export async function processDeck() {
  await wait(1500);
  return {
    summary: "A short three-slide deck: a title slide, a revenue chart showing steady growth, and a team introduction.",
    slides: SLIDES,
  };
}

export async function matchSlide(jpeg, slides) {
  await wait(300);
  return { slideNumber: (frames++ % slides.length) + 1, confidence: 0.9 };
}

export async function describeFrame() {
  await wait(800);
  const { number, title, text, visuals, overview, summary } = SLIDES[frames++ % SLIDES.length];
  return { isSharedContent: true, title, slideNumber: number, text, visuals, overview, summary };
}

export async function transcribe() {
  await wait(400);
  return LINES[lines++ % LINES.length];
}

export async function detectCue({ transcript }) {
  await wait(300);
  if (/as you can see|this chart|look at/i.test(transcript)) {
    return {
      shouldNudge: true,
      cue: "visuals",
      reason: 'You said "as you can see" without saying what is on the slide.',
      suggestion: "Describe the chart out loud, for example: revenue grew from 2.1 to 3.6 million dollars.",
    };
  }
  return { shouldNudge: false, cue: "none", reason: "", suggestion: "" };
}

export async function answerQuestion({ question }) {
  await wait(600);
  if (/revenue|q[1-4]|million/i.test(question)) {
    return { found: true, answer: "On slide 2, revenue grew every quarter, from 2.1 million dollars in Q1 to 3.6 million in Q4.", slideNumbers: [2] };
  }
  if (/team|who/i.test(question)) return { found: true, answer: "On slide 3, the team is four students from the University of Washington.", slideNumbers: [3] };
  return { found: false, answer: "", slideNumbers: [] };
}
