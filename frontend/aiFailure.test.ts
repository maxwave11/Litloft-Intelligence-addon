import { describe, expect, it, vi } from "vitest";

import { explainAiFailure } from "./aiFailure";
import type { IntelligenceStatus } from "./api";
import type { IntelligenceAiActionKind } from "./offerIntelligenceAction";

vi.mock("./api", () => ({ getIntelligenceStatus: vi.fn() }));

const t = (key: string, values?: Record<string, string>) =>
  values?.config ? `${key}:${values.config}` : key;

const READY: IntelligenceStatus = {
  features: {
    indexing: true,
    search: true,
    auto_tags: "manual",
    summaries: "manual",
    detailed_summaries: "manual",
    vision_describe: "manual",
    chapter_suggestions: "manual",
    rag: true,
  },
  llm: { provider: "ollama", model: "m", vision_model: "v", enabled: true, output_language: "auto" },
};

const off = (flag: string): IntelligenceStatus => ({
  ...READY,
  features: { ...READY.features!, [flag]: "false" },
});
const noLlm: IntelligenceStatus = { ...READY, llm: { ...READY.llm!, enabled: false } };
const noVision: IntelligenceStatus = { ...READY, llm: { ...READY.llm!, vision_model: "" } };

describe("explainAiFailure", () => {
  it.each<[IntelligenceAiActionKind, IntelligenceStatus | null, string]>([
    ["tags", null, "aiFailureUnreachable"],
    ["tags", off("auto_tags"), "aiFailureFeatureOff:auto_tags"],
    ["tags", noLlm, "aiFailureGeneric"],
    ["summary", noLlm, "aiFailureLlmOff"],
    ["summary", off("summaries"), "aiFailureFeatureOff:summaries"],
    ["detailedSummary", off("detailed_summaries"), "aiFailureFeatureOff:detailed_summaries"],
    ["detailedSummary", noLlm, "aiFailureLlmOff"],
    ["chapters", noLlm, "aiFailureLlmOff"],
    ["visualDescription", noVision, "aiFailureVisionModel"],
    ["summary", READY, "aiFailureGeneric"],
  ])("%s with %j says %s", async (kind, status, expected) => {
    expect(await explainAiFailure(kind, "videos", t, status ?? undefined as never)).toBe(expected);
  });
});
