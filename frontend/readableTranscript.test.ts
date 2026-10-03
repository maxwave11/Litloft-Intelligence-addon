import { describe, expect, it } from "vitest";

import {
  buildReadableTranscript,
  readableTranscriptMarkdown,
  type ReadableChapter,
  type ReadableCue,
} from "./readableTranscript";

const cue = (start: number, end: number, text: string): ReadableCue => ({ start, end, text });
const chapter = (start_time: number, title: string): ReadableChapter => ({ start_time, title });

const sentence = (n: number) => `This is sentence number ${n} of the talk, said at some length.`;
const spoken = (from: number, count: number): ReadableCue[] =>
  Array.from({ length: count }, (_, i) => cue((from + i) * 5, (from + i) * 5 + 4, sentence(from + i)));

const squash = (s: string) => s.replace(/\s+/g, "");

describe("buildReadableTranscript", () => {
  const cues = spoken(0, 6);

  it.each([
    ["no chapters", [], [null]],
    ["chapters", [chapter(10, "Middle"), chapter(20, "End")], [null, "Middle", "End"]],
    ["a chapter at the first cue", [chapter(0, "Whole")], ["Whole"]],
    ["a chapter with no text", [chapter(10, "Middle"), chapter(500, "Silent")], [null, "Middle"]],
    ["chapters out of order", [chapter(20, "End"), chapter(10, "Middle")], [null, "Middle", "End"]],
    ["a blank title", [chapter(10, "  ")], [null]],
  ])("titles sections for %s", (_name, chapters, titles) => {
    expect(buildReadableTranscript(cues, chapters).map((s) => s.title)).toEqual(titles);
  });

  it("puts a cue that starts on a chapter into that chapter", () => {
    const [lead, middle] = buildReadableTranscript(cues, [chapter(10, "Middle")]);
    expect(lead.paragraphs.join(" ")).toContain("sentence number 1 ");
    expect(lead.paragraphs.join(" ")).not.toContain("sentence number 2 ");
    expect(middle.paragraphs.join(" ")).toContain("sentence number 2 ");
  });

  it.each([
    ["plain", cues, [chapter(10, "A"), chapter(20, "B")]],
    ["many cues", spoken(0, 80), [chapter(100, "A"), chapter(250, "B")]],
    ["no chapters", spoken(0, 80), []],
    ["unsorted cues", [...cues].reverse(), [chapter(10, "A")]],
  ])("keeps every word once and in order (%s)", (_name, input, chapters) => {
    const sections = buildReadableTranscript(input, chapters);
    const sorted = [...input].sort((a, b) => a.start - b.start);
    expect(squash(sections.flatMap((s) => s.paragraphs).join(""))).toBe(
      squash(sorted.map((c) => c.text).join("")),
    );
  });

  it("starts a new paragraph at a long pause once there is enough text", () => {
    const talk = [
      cue(0, 4, "A first thought that takes a while to say, with several clauses, and then more to make it long enough."),
      cue(4.5, 8, "Still the same thought, now continuing for a bit."),
      cue(15, 19, "After a long silence, a new one."),
    ];
    const [section] = buildReadableTranscript(talk, []);
    expect(section.paragraphs).toEqual([
      `${talk[0].text} ${talk[1].text}`,
      talk[2].text,
    ]);
  });

  it("does not break on a pause when the paragraph is still short", () => {
    const talk = [cue(0, 2, "Short."), cue(10, 12, "Also short.")];
    expect(buildReadableTranscript(talk, [])[0].paragraphs).toEqual(["Short. Also short."]);
  });

  it("closes paragraphs only at the end of a sentence", () => {
    const [section] = buildReadableTranscript(spoken(0, 60), []);
    expect(section.paragraphs.length).toBeGreaterThan(3);
    for (const paragraph of section.paragraphs) expect(paragraph.endsWith(".")).toBe(true);
  });

  it("cuts unpunctuated text between cues instead of leaving one wall", () => {
    const words = Array.from({ length: 300 }, (_, i) => cue(i, i + 0.9, `word${i}`));
    const [section] = buildReadableTranscript(words, []);
    expect(section.paragraphs.length).toBeGreaterThan(1);
    expect(squash(section.paragraphs.join(""))).toBe(squash(words.map((w) => w.text).join("")));
  });

  it.each([
    ["Japanese", [cue(0, 2, "今日は"), cue(2, 4, "いい天気です。")], "今日はいい天気です。"],
    ["English", [cue(0, 2, "It is"), cue(2, 4, "fine today.")], "It is fine today."],
    ["mixed", [cue(0, 2, "使うのは"), cue(2, 4, "Docker です。")], "使うのは Docker です。"],
  ])("joins cues the way %s is written", (_name, input, expected) => {
    expect(buildReadableTranscript(input, [])[0].paragraphs).toEqual([expected]);
  });

  it("gives nothing for no cues", () => {
    expect(buildReadableTranscript([], [chapter(0, "A")])).toEqual([]);
    expect(buildReadableTranscript([cue(0, 1, "  ")], [])).toEqual([]);
  });
});

describe("readableTranscriptMarkdown", () => {
  it("writes the title, then each chapter, with no timestamps", () => {
    const sections = buildReadableTranscript(
      [cue(0, 2, "Hello there."), cue(70, 72, "Second part.")],
      [chapter(60, "Part two")],
    );
    const markdown = readableTranscriptMarkdown("My talk", sections);
    expect(markdown).toBe("# My talk\n\nHello there.\n\n## Part two\n\nSecond part.");
    expect(markdown).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("leaves the title out when there is none", () => {
    expect(readableTranscriptMarkdown("", [{ title: null, paragraphs: ["Only."] }])).toBe("Only.");
  });
});
