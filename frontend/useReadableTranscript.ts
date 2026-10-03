"use client";

import { useEffect, useMemo, useState } from "react";

import { getFileTranscript } from "./api";
import type { TranscriptChunkItem } from "./api";
import { parseVttCues } from "./vttCues";
import {
  buildReadableTranscript,
  type ReadableChapter,
  type ReadableSection,
} from "./readableTranscript";
import { getFileChapters } from "@/lib/api";

/**
 * The word-level subtitles are cut every few seconds, which is what lets a
 * chapter boundary land close to where it was spoken; the chunks are the
 * fallback for a file indexed before words were kept.
 */
export async function loadReadableCues(
  fileId: string,
  drive: string,
  signal?: AbortSignal,
): Promise<{ cues: TranscriptChunkItem[]; language: string | undefined }> {
  const words = fetch(`/api/addons/intelligence/files/${fileId}/subtitles.vtt`, { signal })
    .then((r) => (r.ok ? r.text() : ""))
    .then((text) => (text ? parseVttCues(text) : []))
    .catch(() => [] as TranscriptChunkItem[]);
  const [transcript, wordCues] = await Promise.all([getFileTranscript(fileId, drive), words]);
  return {
    cues: wordCues.length > 0 ? wordCues : (transcript.chunks ?? []),
    language: transcript.language || undefined,
  };
}

export function useReadableTranscript(
  fileId: string,
  drive: string,
  chaptersVersion: number,
): { sections: ReadableSection[]; loaded: boolean } {
  const [cues, setCues] = useState<TranscriptChunkItem[]>([]);
  const [language, setLanguage] = useState<string | undefined>();
  const [loaded, setLoaded] = useState(false);
  const [chapters, setChapters] = useState<ReadableChapter[]>([]);

  useEffect(() => {
    let cancelled = false;
    setCues([]);
    setLanguage(undefined);
    setLoaded(false);
    loadReadableCues(fileId, drive).then((read) => {
      if (cancelled) return;
      setLanguage(read.language);
      setCues(read.cues);
      setLoaded(true);
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

  return { sections, loaded };
}
