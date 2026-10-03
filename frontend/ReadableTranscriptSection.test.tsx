import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { getFileTranscript, getFileChapters, copyText, toast } = vi.hoisted(() => ({
  getFileTranscript: vi.fn(),
  getFileChapters: vi.fn(),
  copyText: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/addons/intelligence/api", () => ({ getFileTranscript }));
vi.mock("@/lib/api", () => ({ getFileChapters }));
vi.mock("@/lib/copyText", () => ({ copyText }));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => toast }));

import ReadableTranscriptSection from "@/addons/intelligence/ReadableTranscriptSection";

const VTT = `WEBVTT

00:00:00.000 --> 00:00:04.000
Welcome to the talk.

00:01:10.000 --> 00:01:14.000
Now for the second part.
`;

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function respond(vtt: string | null) {
  fetchMock.mockResolvedValue(
    vtt === null
      ? ({ ok: false, status: 404, text: async () => "" } as Response)
      : ({ ok: true, status: 200, text: async () => vtt } as Response),
  );
}

beforeEach(() => {
  getFileTranscript.mockReset().mockResolvedValue({
    available: true,
    language: "en",
    chunks: [{ index: 0, text: "From the chunks.", start: 0, end: 10 }],
  });
  getFileChapters
    .mockReset()
    .mockResolvedValue({ chapters: [{ start_time: 60, end_time: null, title: "Part two", ordering: 0 }], source: "curated" });
  copyText.mockReset().mockResolvedValue(true);
  toast.success.mockReset();
  toast.error.mockReset();
  respond(VTT);
});

afterEach(cleanup);

const mount = () => render(<ReadableTranscriptSection fileId="f1" drive="d" title="My talk" />);

describe("ReadableTranscriptSection", () => {
  it("shows the text under the chapter it was spoken in", async () => {
    mount();
    const heading = await screen.findByRole("heading", { level: 3, name: "Part two" });
    expect(heading.nextElementSibling?.textContent).toBe("Now for the second part.");
    expect(screen.getByText("Welcome to the talk.")).toBeTruthy();
  });

  it("falls back to the chunks when the file has no word-level subtitles", async () => {
    respond(null);
    mount();
    expect(await screen.findByText("From the chunks.")).toBeTruthy();
  });

  it("renders nothing for a file with no transcript", async () => {
    respond(null);
    getFileTranscript.mockResolvedValue({ available: false });
    const { container } = mount();
    await waitFor(() => expect(getFileTranscript).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("copies the title, chapters and text as markdown, without timestamps", async () => {
    mount();
    await screen.findByText("Welcome to the talk.");
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(copyText).toHaveBeenCalledWith(
      "# My talk\n\nWelcome to the talk.\n\n## Part two\n\nNow for the second part.",
    );
  });

  it("reports a copy that did not happen", async () => {
    copyText.mockResolvedValue(false);
    mount();
    await screen.findByText("Welcome to the talk.");
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });
});
