import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import AdminAnalysisPromptSettingsSection from "./AdminAnalysisPromptSettingsSection";

const ENDPOINT = "/api/addons/intelligence/admin/analysis-prompt";
const DEFAULT_TEXT = "Built-in prompt.";

type Reply = { status?: number; body: unknown };

const mockFetch = vi.fn();

function jsonResponse({ status = 200, body }: Reply) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** One queue of replies per "METHOD url"; the last reply repeats. */
function serve(routes: Record<string, Reply | Reply[]>) {
  const queues = Object.fromEntries(
    Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]),
  );
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const queue = queues[key];
    if (!queue) throw new Error(`unexpected ${key}`);
    return jsonResponse(queue.length > 1 ? queue.shift()! : queue[0]);
  });
}

const view = (prompt: string) => ({
  prompt,
  default: DEFAULT_TEXT,
  is_default: prompt === DEFAULT_TEXT,
});

const callsTo = (method: string) =>
  mockFetch.mock.calls.filter((c) => (c[1]?.method ?? "GET") === method && c[0] === ENDPOINT);

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  mockFetch.mockReset();
  vi.unstubAllGlobals();
});

async function renderWith(routes: Record<string, Reply | Reply[]>) {
  serve(routes);
  render(<AdminAnalysisPromptSettingsSection />);
  return screen.findByRole("textbox", { name: "Prompt" });
}

describe("AdminAnalysisPromptSettingsSection", () => {
  it("shows the built-in prompt, says so, and offers no reset", async () => {
    const box = await renderWith({ [`GET ${ENDPOINT}`]: { body: view(DEFAULT_TEXT) } });

    expect(box).toHaveValue(DEFAULT_TEXT);
    expect(screen.getByText("The built-in prompt is in use.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset to default" })).toBeNull();
  });

  it("saves the edited text exactly as typed, then shows what the server now holds", async () => {
    const box = await renderWith({
      [`GET ${ENDPOINT}`]: [{ body: view(DEFAULT_TEXT) }, { body: view("\nMine.\n") }],
      [`PUT ${ENDPOINT}`]: { body: { status: "saved" } },
    });

    fireEvent.change(box, { target: { value: "\nMine.\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(JSON.parse(String(callsTo("PUT")[0][1].body))).toEqual({ prompt: "\nMine.\n" });
    expect(await screen.findByText("A custom prompt is in use.")).toBeInTheDocument();
  });

  it("does not allow saving an unchanged or blank prompt", async () => {
    const box = await renderWith({ [`GET ${ENDPOINT}`]: { body: view(DEFAULT_TEXT) } });
    const save = screen.getByRole("button", { name: "Save" });

    expect(save).toBeDisabled();
    fireEvent.change(box, { target: { value: "   " } });
    expect(save).toBeDisabled();
    fireEvent.change(box, { target: { value: "Something" } });
    expect(save).toBeEnabled();
  });

  it("shows the server's reason when a save is refused", async () => {
    const box = await renderWith({
      [`GET ${ENDPOINT}`]: { body: view(DEFAULT_TEXT) },
      [`PUT ${ENDPOINT}`]: { status: 400, body: { detail: "the prompt must not contain NUL characters" } },
    });

    fireEvent.change(box, { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("the prompt must not contain NUL characters")).toBeInTheDocument();
  });

  it("resets to the built-in prompt", async () => {
    await renderWith({
      [`GET ${ENDPOINT}`]: [{ body: view("Mine.") }, { body: view(DEFAULT_TEXT) }],
      [`DELETE ${ENDPOINT}`]: { body: { status: "reset", removed: true } },
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));

    expect(await screen.findByText("Reset to the built-in prompt")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue(DEFAULT_TEXT));
    expect(screen.queryByRole("button", { name: "Reset to default" })).toBeNull();
  });

  it("says when the prompt could not be loaded", async () => {
    serve({ [`GET ${ENDPOINT}`]: { status: 500, body: {} } });
    render(<AdminAnalysisPromptSettingsSection />);

    expect(await screen.findByText("HTTP 500")).toBeInTheDocument();
  });
});
