export interface ReadableCue {
  start: number;
  end: number;
  text: string;
}

export interface ReadableChapter {
  start_time: number;
  title: string;
}

export interface ReadableSection {
  /** `null` for text before the first chapter, or when there are no chapters. */
  title: string | null;
  paragraphs: string[];
}

// Reading-length judgements, not measurements.
const PARAGRAPH_TARGET = 400;
const PAUSE_BREAK_SECONDS = 2;
const PAUSE_BREAK_MIN = 150;

const IDEOGRAPHIC = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}、。！？「」]/u;

/**
 * Two cues of a script written without spaces run together; any other pair
 * gets one. A wrong guess costs a stray space, never lost text.
 */
function joinCues(left: string, right: string): string {
  if (!left) return right;
  const a = left[left.length - 1];
  const b = right[0];
  return IDEOGRAPHIC.test(a) && IDEOGRAPHIC.test(b) ? left + right : `${left} ${right}`;
}

function sentenceStarts(text: string, language: string | undefined): number[] {
  const starts: number[] = [];
  try {
    let segmenter: Intl.Segmenter;
    try {
      segmenter = new Intl.Segmenter(language || undefined, { granularity: "sentence" });
    } catch {
      // An unrecognised language tag; the default locale still finds `.`/`。`.
      segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
    }
    for (const part of segmenter.segment(text)) starts.push(part.index);
  } catch {
    // No Intl.Segmenter: the paragraph is cut at cue boundaries instead.
    return [0];
  }
  return starts.length > 0 ? starts : [0];
}

function paragraphsOf(cues: ReadableCue[], language: string | undefined): string[] {
  let text = "";
  const cueStarts: number[] = [];
  const pauseStarts = new Set<number>();
  cues.forEach((cue, i) => {
    const clean = cue.text.replace(/\s+/g, " ").trim();
    const joined = joinCues(text, clean);
    // `joined` ends with `clean`, so the cue begins that far from the end.
    const at = joined.length - clean.length;
    cueStarts.push(at);
    if (i > 0 && cue.start - cues[i - 1].end >= PAUSE_BREAK_SECONDS) {
      pauseStarts.add(at);
    }
    text = joined;
  });

  // Cut points, in text order: sentence starts, plus every cue start so a
  // text without punctuation can still be cut somewhere that is not mid-word.
  const sentences = new Set(sentenceStarts(text, language));
  const cuts = [...new Set([...sentences, ...cueStarts])].sort((a, b) => a - b);

  const paragraphs: string[] = [];
  let from = 0;
  for (const cut of cuts) {
    if (cut <= from) continue;
    const length = cut - from;
    const atSentence = sentences.has(cut);
    const atPause = pauseStarts.has(cut) && atSentence && length >= PAUSE_BREAK_MIN;
    // A cue boundary inside a sentence is only taken when the sentence has
    // run past the target by itself, i.e. there is no punctuation to use.
    const overlong = length >= PARAGRAPH_TARGET && (atSentence || length >= PARAGRAPH_TARGET * 2);
    if (atPause || overlong) {
      paragraphs.push(text.slice(from, cut).trim());
      from = cut;
    }
  }
  const rest = text.slice(from).trim();
  if (rest) paragraphs.push(rest);
  return paragraphs;
}

/**
 * Cues split at the chapters they fall in and grouped into paragraphs, with
 * no timestamps. A cue belongs to the last chapter that starts at or before
 * it; a chapter with no text is left out.
 */
export function buildReadableTranscript(
  cues: ReadableCue[],
  chapters: ReadableChapter[],
  language?: string,
): ReadableSection[] {
  const spoken = cues
    .filter((cue) => cue.text.trim())
    .sort((a, b) => a.start - b.start);
  const titled = chapters
    .filter((chapter) => chapter.title.trim())
    .sort((a, b) => a.start_time - b.start_time);

  const groups: { title: string | null; cues: ReadableCue[] }[] = [
    { title: null, cues: [] },
    ...titled.map((chapter) => ({ title: chapter.title.trim(), cues: [] as ReadableCue[] })),
  ];
  let current = 0;
  for (const cue of spoken) {
    while (current < titled.length && titled[current].start_time <= cue.start) {
      current += 1;
    }
    groups[current].cues.push(cue);
  }

  return groups
    .filter((group) => group.cues.length > 0)
    .map((group) => ({
      title: group.title,
      paragraphs: paragraphsOf(group.cues, language),
    }));
}

function sectionBlocks(sections: ReadableSection[], headingMark: string): string[] {
  const blocks: string[] = [];
  for (const section of sections) {
    if (section.title) blocks.push(`${headingMark} ${section.title}`);
    blocks.push(...section.paragraphs);
  }
  return blocks;
}

/** Markdown for pasting into an agent: the video's title, then each chapter. */
export function readableTranscriptMarkdown(
  title: string,
  sections: ReadableSection[],
): string {
  const blocks: string[] = [];
  if (title.trim()) blocks.push(`# ${title.trim()}`);
  blocks.push(...sectionBlocks(sections, "##"));
  return blocks.join("\n\n");
}

/**
 * The chapters alone, a level below where `readableTranscriptMarkdown` puts
 * them, for a document that already has the video's title and its own headings.
 */
export function readableTranscriptBody(sections: ReadableSection[]): string {
  return sectionBlocks(sections, "####").join("\n\n");
}
