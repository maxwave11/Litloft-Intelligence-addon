"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { TRANSCRIPT_EXPORT_ID } from "./exportIds";
import { loadReadableCues } from "./useReadableTranscript";
import { buildReadableTranscript, readableTranscriptBody } from "./readableTranscript";
import { useOfferExportSection, type ExportSectionProvider } from "@/lib/exportSections";
import { getFileChapters } from "@/lib/api";

export default function TranscriptExportSection() {
  const t = useTranslations("searchIndex");
  const label = t("exportTranscript");

  const provider = useMemo<ExportSectionProvider>(
    () => ({
      id: TRANSCRIPT_EXPORT_ID,
      label,
      order: 10,
      build: async (file, drive, signal) => {
        if (file.file_type !== "video" && file.file_type !== "audio") {
          return { kind: "not-applicable" };
        }
        const [{ cues, language }, chapters] = await Promise.all([
          loadReadableCues(file.id, drive, signal),
          getFileChapters(file.id)
            .then((res) => res.chapters)
            .catch(() => []),
        ]);
        signal.throwIfAborted();
        const sections = buildReadableTranscript(cues, chapters, language);
        return sections.length === 0
          ? { kind: "empty" }
          : { kind: "section", markdown: readableTranscriptBody(sections) };
      },
    }),
    [label],
  );

  useOfferExportSection(provider);
  return null;
}
