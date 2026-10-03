import { getIntelligenceStatus } from "./api";
import type { IntelligenceStatus } from "./api";
import type { IntelligenceAiActionKind } from "./offerIntelligenceAction";

type Translate = (key: string, values?: Record<string, string>) => string;

const FEATURE: Record<IntelligenceAiActionKind, { flag: string; config: string }> = {
  tags: { flag: "auto_tags", config: "auto_tags" },
  summary: { flag: "summaries", config: "summaries" },
  detailedSummary: { flag: "detailed_summaries", config: "detailed_summaries" },
  chapters: { flag: "chapter_suggestions", config: "chapter_suggestions" },
  visualDescription: { flag: "vision_describe", config: "vision_describe" },
};

/** Tag candidates have a local fallback; everything else writes through the LLM. */
const NEEDS_LLM: Record<IntelligenceAiActionKind, boolean> = {
  tags: false,
  summary: true,
  detailedSummary: true,
  chapters: true,
  visualDescription: true,
};

/**
 * Why a generation request was refused, in words the viewer can act on.
 *
 * The request's own error carries only a status code, so the cause is read
 * from `/status` after the fact: the same flags the server checked.
 */
export async function explainAiFailure(
  kind: IntelligenceAiActionKind,
  drive: string,
  t: Translate,
  status?: IntelligenceStatus | null,
): Promise<string> {
  const current = status ?? (await getIntelligenceStatus(drive));
  if (!current) return t("aiFailureUnreachable");

  const { flag, config } = FEATURE[kind];
  const mode = (current.features as Record<string, unknown> | undefined)?.[flag];
  if (mode === "false") return t("aiFailureFeatureOff", { config });

  if (NEEDS_LLM[kind] && !current.llm?.enabled) return t("aiFailureLlmOff");

  if (kind === "visualDescription" && !current.llm?.vision_model) {
    return t("aiFailureVisionModel");
  }
  return t("aiFailureGeneric");
}
