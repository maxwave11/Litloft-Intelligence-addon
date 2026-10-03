import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const {
  getFileTranscript,
  listUserSummaries,
  createUserSummary,
  updateUserSummary,
  getFileChapters,
  copyText,
  toast,
} = vi.hoisted(() => ({
  getFileTranscript: vi.fn(),
  listUserSummaries: vi.fn(),
  createUserSummary: vi.fn(),
  updateUserSummary: vi.fn(),
  getFileChapters: vi.fn(),
  copyText: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/addons/intelligence/api", () => ({
  getFileTranscript,
  listUserSummaries,
  createUserSummary,
  updateUserSummary,
}));
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
  listUserSummaries.mockReset().mockResolvedValue([]);
  createUserSummary.mockReset();
  updateUserSummary.mockReset();
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
const textbox = () => screen.getByRole("textbox", { name: "Summary in Markdown" }) as HTMLTextAreaElement;
const titleBox = () => screen.getByRole("textbox", { name: "Summary title" }) as HTMLInputElement;

const brief = { id: "s1", title: "Brief", content: "Short." };
const detailed = { id: "s2", title: "Detailed", content: "## Key points\n\n- **one**" };

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
    ["a transcript and no summary", true, [], ["Transcript by chapter", "Add summary"], "Transcript by chapter"],
    [
      "a transcript and two summaries",
      true,
      [brief, detailed],
      ["Transcript by chapter", "Brief", "Detailed", "Add summary"],
      "Brief",
    ],
    ["summaries and no transcript", false, [brief, detailed], ["Brief", "Detailed", "Add summary"], "Brief"],
    ["neither", false, [], ["Add summary"], "Add summary"],
    ["one untitled summary", false, [{ id: "a", title: null, content: "x" }], ["Summary", "Add summary"], "Summary"],
    [
      "several untitled summaries",
      false,
      [
        { id: "a", title: null, content: "x" },
        { id: "b", title: null, content: "y" },
      ],
      ["Summary 1", "Summary 2", "Add summary"],
      "Summary 1",
    ],
  ])("with %s", async (_name, transcript, summaries, tabs, selected) => {
    if (!transcript) withoutTranscript();
    listUserSummaries.mockResolvedValue(summaries);
    mount();
    await screen.findAllByRole("tab");
    expect(tabNames()).toEqual(tabs);
    expect(selectedTab()).toBe(selected);
  });

  it("keeps a summary being edited while another tab is open", async () => {
    listUserSummaries.mockResolvedValue([brief]);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(textbox(), { target: { value: "draft" } });
    fireEvent.click(screen.getByRole("tab", { name: "Transcript by chapter" }));
    fireEvent.click(screen.getByRole("tab", { name: "Brief" }));
    expect(textbox().value).toBe("draft");
  });
});

describe("a summary tab", () => {
  it("shows the summary as formatted markdown", async () => {
    listUserSummaries.mockResolvedValue([detailed]);
    mount();
    expect(await screen.findByRole("heading", { level: 2, name: "Key points" })).toBeTruthy();
    expect(screen.getByText("one").tagName).toBe("STRONG");
  });

  it("saves an edit of the text and the title and shows it formatted again", async () => {
    listUserSummaries.mockResolvedValue([brief, detailed]);
    updateUserSummary.mockResolvedValue({ id: "s1", title: "Tiny", content: "# New" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(textbox().value).toBe("Short.");
    fireEvent.change(titleBox(), { target: { value: "Tiny" } });
    fireEvent.change(textbox(), { target: { value: "# New" } });
    expect(dirtyRegistry.isDirty("f1")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { level: 1, name: "New" })).toBeTruthy();
    expect(updateUserSummary).toHaveBeenCalledWith("f1", "d", "s1", { title: "Tiny", content: "# New" });
    expect(tabNames()).toEqual(["Transcript by chapter", "Tiny", "Detailed", "Add summary"]);
    await waitFor(() => expect(dirtyRegistry.isDirty("f1")).toBe(false));
  });

  it("cancel leaves the saved summary alone", async () => {
    listUserSummaries.mockResolvedValue([brief]);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(textbox(), { target: { value: "Thrown away" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Short.")).toBeTruthy();
    expect(updateUserSummary).not.toHaveBeenCalled();
  });

  it("keeps the draft open when the save fails", async () => {
    listUserSummaries.mockResolvedValue([brief]);
    updateUserSummary.mockRejectedValue(new Error("500"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(textbox(), { target: { value: "Mine" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(textbox().value).toBe("Mine");
  });

  it("saved empty, it is removed and the first remaining summary opens", async () => {
    listUserSummaries.mockResolvedValue([brief, detailed]);
    updateUserSummary.mockResolvedValue(null);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(textbox(), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(tabNames()).toEqual(["Transcript by chapter", "Detailed", "Add summary"]));
    expect(selectedTab()).toBe("Detailed");
    await waitFor(() => expect(dirtyRegistry.isDirty("f1")).toBe(false));
  });
});

describe("the add summary tab", () => {
  it("creates a summary and opens its tab", async () => {
    listUserSummaries.mockResolvedValue([brief]);
    createUserSummary.mockResolvedValue({ id: "s3", title: "Detailed", content: "Long." });
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "Add summary" }));
    expect(document.activeElement).toBe(textbox());
    fireEvent.change(titleBox(), { target: { value: " Detailed " } });
    fireEvent.change(textbox(), { target: { value: "Long." } });
    fireEvent.keyDown(textbox(), { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(selectedTab()).toBe("Detailed"));
    expect(createUserSummary).toHaveBeenCalledWith("f1", "d", { title: "Detailed", content: "Long." });
    expect(tabNames()).toEqual(["Transcript by chapter", "Brief", "Detailed", "Add summary"]);
    expect(screen.getByText("Long.")).toBeTruthy();
  });

  it("cannot save a summary with no text", async () => {
    withoutTranscript();
    mount();
    await screen.findAllByRole("tab");
    fireEvent.change(titleBox(), { target: { value: "Only a title" } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not take the caret when the page merely opened on it", async () => {
    withoutTranscript();
    mount();
    await screen.findAllByRole("tab");
    expect(document.activeElement).not.toBe(textbox());
  });
});
