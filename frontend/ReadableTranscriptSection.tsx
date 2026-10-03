"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, FileText } from "lucide-react";
import { useTranslations } from "next-intl";

import { getFileTranscript } from "./api";
import type { TranscriptChunkItem } from "./api";
import { parseVttCues } from "./vttCues";
import {
  buildReadableTranscript,
  readableTranscriptMarkdown,
  type ReadableChapter,
} from "./readableTranscript";
import { getFileChapters } from "@/lib/api";
import { copyText } from "@/lib/copyText";
import { useToast } from "@/components/ToastProvider";

interface ReadableTranscriptSectionProps {
  fileId: string;
  drive: string;
  filename?: string;
  title?: string;
  /** Changes when the file's chapters are replaced. */
  chaptersVersion?: number;
}

export default function ReadableTranscriptSection({
  fileId,
  drive,
  filename,
  title,
  chaptersVersion = 0,
}: ReadableTranscriptSectionProps) {
  const t = useTranslations("searchIndex");
  const toast = useToast();
  const [cues, setCues] = useState<TranscriptChunkItem[]>([]);
  const [language, setLanguage] = useState<string | undefined>();
  const [chapters, setChapters] = useState<ReadableChapter[]>([]);

  // The word-level subtitles are cut every few seconds, which is what lets a
  // chapter boundary land close to where it was spoken; the chunks are the
  // fallback for a file indexed before words were kept.
  useEffect(() => {
    let cancelled = false;
    setCues([]);
    setLanguage(undefined);
    const words = fetch(`/api/addons/intelligence/files/${fileId}/subtitles.vtt`)
      .then((r) => (r.ok ? r.text() : ""))
      .then((text) => (text ? parseVttCues(text) : []))
      .catch(() => [] as TranscriptChunkItem[]);
    Promise.all([getFileTranscript(fileId, drive), words]).then(([transcript, wordCues]) => {
      if (cancelled) return;
      setLanguage(transcript.language || undefined);
      setCues(wordCues.length > 0 ? wordCues : (transcript.chunks ?? []));
    });
    return () => {
      cancelled = true;
    };
  }, [fileId, drive]);

  useEffect(() => {
    let cancelled = false;
    getFileChapters(fileId)
      .then((res) => {
        if (!cancelled) setChapters(res.chapters);
      })
      .catch(() => {
        if (!cancelled) setChapters([]);
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, chaptersVersion]);

  const sections = useMemo(
    () => buildReadableTranscript(cues, chapters, language),
    [cues, chapters, language],
  );

  const copy = useCallback(async () => {
    const markdown = readableTranscriptMarkdown(title || filename || "", sections);
    if (await copyText(markdown)) {
      toast.success(t("readableTranscriptCopied"));
    } else {
      toast.error(t("readableTranscriptCopyFailed"));
    }
  }, [filename, sections, t, title, toast]);

  if (sections.length === 0) return null;

  return (
    <section className="reading-measure" aria-labelledby="readable-transcript-title">
      <div className="mb-3 flex items-center gap-2">
        <FileText size={14} className="text-accent-teal" />
        <h2 id="readable-transcript-title" className="text-sm font-semibold">
          {t("readableTranscriptTitle")}
        </h2>
        <button
          type="button"
          onClick={() => void copy()}
          className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary pointer-coarse:min-h-11"
        >
          <Copy size={12} />
          {t("readableTranscriptCopy")}
        </button>
      </div>
      <div className="text-base leading-relaxed text-text-primary [&>div+div]:mt-[1.4em]">
        {sections.map((section, i) => (
          <div key={`${i}-${section.title ?? ""}`}>
            {section.title && (
              <h3 className="mb-[0.4em] text-[1.15em] font-semibold leading-[1.45]">
                {section.title}
              </h3>
            )}
            {section.paragraphs.map((paragraph, j) => (
              <p key={j} className="mb-[1em] last:mb-0">
                {paragraph}
              </p>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
