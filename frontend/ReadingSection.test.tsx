import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { getFileTranscript, getUserSummary, saveUserSummary, getFileChapters, copyText, toast } =
  vi.hoisted(() => ({
    getFileTranscript: vi.fn(),
    getUserSummary: vi.fn(),
    saveUserSummary: vi.fn(),
    getFileChapters: vi.fn(),
    copyText: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  }));

vi.mock("@/addons/intelligence/api", () => ({ getFileTranscript, getUserSummary, saveUserSummary }));
vi.mock("@/lib/api", () => ({ getFileChapters }));
vi.mock("@/lib/copyText", () => ({ copyText }));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => toast }));

import ReadingSection from "@/addons/intelligence/ReadingSection";
import { dirtyRegistry } from "@/lib/dirtyRegistry";

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

function withoutTranscript() {
  respond(null);
  getFileTranscript.mockResolvedValue({ available: false });
}

beforeEach(() => {
  getFileTranscript.mockReset().mockResolvedValue({
    available: true,
    language: "en",
    chunks: [{ index: 0, text: "From the chunks.", start: 0, end: 10 }],
  });
  getUserSummary.mockReset().mockResolvedValue({ available: false });
  saveUserSummary.mockReset();
  getFileChapters
    .mockReset()
    .mockResolvedValue({ chapters: [{ start_time: 60, end_time: null, title: "Part two", ordering: 0 }], source: "curated" });
  copyText.mockReset().mockResolvedValue(true);
  toast.success.mockReset();
  toast.error.mockReset();
  respond(VTT);
});

afterEach(cleanup);

const mount = () => render(<ReadingSection fileId="f1" drive="d" title="My talk" />);

const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.textContent);
const selectedTab = () =>
  screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;

describe("the transcript tab", () => {
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

  it("copies the title, chapters and text as markdown, without timestamps", async () => {
    mount();
    await screen.findByText("Welcome to the talk.");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(copyText).toHaveBeenCalledWith(
      "# My talk\n\nWelcome to the talk.\n\n## Part two\n\nNow for the second part.",
    );
  });

  it("reports a copy that did not happen", async () => {
    copyText.mockResolvedValue(false);
    mount();
    await screen.findByText("Welcome to the talk.");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("which tabs are offered and which one opens", () => {
  it.each([
    ["a transcript and no summary", true, false, ["Transcript by chapter", "Summary"], "Transcript by chapter"],
    ["a transcript and a summary", true, true, ["Transcript by chapter", "Summary"], "Summary"],
    ["a summary and no transcript", false, true, ["Summary"], "Summary"],
    ["neither", false, false, ["Summary"], "Summary"],
  ])("with %s", async (_name, transcript, summary, tabs, selected) => {
    if (!transcript) withoutTranscript();
    if (summary) getUserSummary.mockResolvedValue({ available: true, content: "Short." });
    mount();
    await screen.findAllByRole("tab");
    expect(tabNames()).toEqual(tabs);
    expect(selectedTab()).toBe(selected);
  });

  it("switches panels without losing a summary being edited", async () => {
    mount();
    await screen.findByText("Welcome to the talk.");
    fireEvent.click(screen.getByRole("tab", { name: "Summary" }));
    fireEvent.click(screen.getByRole("button", { name: "Add summary" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "draft" } });
    fireEvent.click(screen.getByRole("tab", { name: "Transcript by chapter" }));
    fireEvent.click(screen.getByRole("tab", { name: "Summary" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("draft");
  });
});

describe("the summary tab", () => {
  it("shows a saved summary as formatted markdown", async () => {
    getUserSummary.mockResolvedValue({ available: true, content: "## Key points\n\n- **one**" });
    mount();
    expect(await screen.findByRole("heading", { level: 2, name: "Key points" })).toBeTruthy();
    expect(screen.getByText("one").tagName).toBe("STRONG");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("saves edited markdown and goes back to showing it formatted", async () => {
    getUserSummary.mockResolvedValue({ available: true, content: "Old." });
    saveUserSummary.mockResolvedValue({ available: true, content: "# New" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.value).toBe("Old.");
    fireEvent.change(box, { target: { value: "# New" } });
    expect(dirtyRegistry.isDirty("f1")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { level: 1, name: "New" })).toBeTruthy();
    expect(saveUserSummary).toHaveBeenCalledWith("f1", "d", "# New");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(dirtyRegistry.isDirty("f1")).toBe(false);
  });

  it("cancel leaves the saved summary alone", async () => {
    getUserSummary.mockResolvedValue({ available: true, content: "Kept." });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Thrown away" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Kept.")).toBeTruthy();
    expect(saveUserSummary).not.toHaveBeenCalled();
  });

  it("keeps the draft open when the save fails", async () => {
    withoutTranscript();
    saveUserSummary.mockRejectedValue(new Error("500"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Add summary" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Mine" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Mine");
  });

  it("clearing the text and saving leaves the file without a summary", async () => {
    getUserSummary.mockResolvedValue({ available: true, content: "Gone soon." });
    saveUserSummary.mockResolvedValue({ available: false });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Add summary" })).toBeTruthy();
    expect(saveUserSummary).toHaveBeenCalledWith("f1", "d", "");
  });
});
