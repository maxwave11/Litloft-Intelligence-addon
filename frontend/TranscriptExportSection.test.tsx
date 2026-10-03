import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";

const { getFileTranscript, getFileChapters } = vi.hoisted(() => ({
  getFileTranscript: vi.fn(),
  getFileChapters: vi.fn(),
}));

vi.mock("@/addons/intelligence/api", () => ({ getFileTranscript }));
vi.mock("@/lib/api", () => ({ getFileChapters }));

import TranscriptExportSection from "@/addons/intelligence/TranscriptExportSection";
import { resetExportSections, useExportSections } from "@/lib/exportSections";
import type { FileItem } from "@/types";

const VTT = `WEBVTT

00:00:00.000 --> 00:00:04.000
Welcome to the talk.

00:01:10.000 --> 00:01:14.000
Now for the second part.
`;

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function respondWith(vtt: string | null) {
  fetchMock.mockResolvedValue(
    vtt === null
      ? ({ ok: false, status: 404, text: async () => "" } as Response)
      : ({ ok: true, status: 200, text: async () => vtt } as Response),
  );
}

const file = (over: Partial<FileItem> = {}) =>
  ({ id: "f1", file_type: "video", ...over }) as FileItem;

function offered() {
  render(<TranscriptExportSection />);
  const { result } = renderHook(() => useExportSections());
  return result.current[0];
}

beforeEach(() => {
  fetchMock.mockReset();
  getFileTranscript.mockReset();
  getFileChapters.mockReset();
  getFileTranscript.mockResolvedValue({ available: false });
  getFileChapters.mockResolvedValue({ chapters: [] });
  respondWith(null);
});

afterEach(() => {
  cleanup();
  act(() => resetExportSections());
});

describe("TranscriptExportSection", () => {
  it("offers a provider named after the slot entry, ahead of any other", () => {
    const provider = offered();

    expect(provider.id).toBe("transcript-export");
    expect(provider.label).toBe("Transcript");
    expect(provider.order).toBe(10);
  });

  it("writes the chapters a level below the video's heading", async () => {
    respondWith(VTT);
    getFileChapters.mockResolvedValue({ chapters: [{ start_time: 60, title: "Second part" }] });

    const result = await offered().build(file(), "d", new AbortController().signal);

    expect(result).toEqual({
      kind: "section",
      markdown: "Welcome to the talk.\n\n#### Second part\n\nNow for the second part.",
    });
  });

  it("falls back to the transcript chunks for a file indexed before words were kept", async () => {
    getFileTranscript.mockResolvedValue({
      available: true,
      language: "en",
      chunks: [{ index: 0, start: 0, end: 4, text: "From the chunks." }],
    });

    const result = await offered().build(file(), "d", new AbortController().signal);

    expect(result).toEqual({ kind: "section", markdown: "From the chunks." });
  });

  it("says it is empty for a video with no transcript", async () => {
    const result = await offered().build(file(), "d", new AbortController().signal);

    expect(result).toEqual({ kind: "empty" });
  });

  it("still writes the transcript when the chapters cannot be read", async () => {
    respondWith(VTT);
    getFileChapters.mockRejectedValue(new Error("offline"));

    const result = await offered().build(file(), "d", new AbortController().signal);

    expect(result).toEqual({
      kind: "section",
      markdown: "Welcome to the talk. Now for the second part.",
    });
  });

  it("answers not-applicable, and asks for nothing, for a file that is not video or audio", async () => {
    const result = await offered().build(
      file({ file_type: "image" }),
      "d",
      new AbortController().signal,
    );

    expect(result).toEqual({ kind: "not-applicable" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getFileTranscript).not.toHaveBeenCalled();
    expect(getFileChapters).not.toHaveBeenCalled();
  });

  it("gives up once the signal has aborted", async () => {
    respondWith(VTT);
    const controller = new AbortController();
    const pending = offered().build(file(), "d", controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow();
  });
});
