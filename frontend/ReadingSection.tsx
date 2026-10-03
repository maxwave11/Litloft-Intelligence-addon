"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Copy, FileText, NotebookText } from "lucide-react";
import { useTranslations } from "next-intl";

import { getUserSummary } from "./api";
import { readableTranscriptMarkdown } from "./readableTranscript";
import { useReadableTranscript } from "./useReadableTranscript";
import UserSummaryPanel from "./UserSummaryPanel";
import { PageTabs } from "@/components/PageTabs";
import { copyText } from "@/lib/copyText";
import { useToast } from "@/components/ToastProvider";

type Tab = "transcript" | "summary";

interface ReadingSectionProps {
  fileId: string;
  drive: string;
  filename?: string;
  title?: string;
  /** Changes when the file's chapters are replaced. */
  chaptersVersion?: number;
}

export default function ReadingSection({
  fileId,
  drive,
  filename,
  title,
  chaptersVersion = 0,
}: ReadingSectionProps) {
  const t = useTranslations("searchIndex");
  const toast = useToast();
  const idBase = useId();
  const { sections, loaded: transcriptLoaded } = useReadableTranscript(
    fileId,
    drive,
    chaptersVersion,
  );
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setSummaryLoaded(false);
    setTab(null);
    getUserSummary(fileId, drive)
      .then((res) => {
        if (!cancelled) setSummary(res.available ? (res.content ?? null) : null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSummaryLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, drive]);

  const hasTranscript = sections.length > 0;

  // Chosen once both answers are in, so the page does not open on one tab
  // and jump to the other when the slower request lands.
  useEffect(() => {
    if (tab !== null || !transcriptLoaded || !summaryLoaded) return;
    setTab(summary !== null || !hasTranscript ? "summary" : "transcript");
  }, [tab, transcriptLoaded, summaryLoaded, summary, hasTranscript]);

  const copy = useCallback(async () => {
    const markdown = readableTranscriptMarkdown(title || filename || "", sections);
    if (await copyText(markdown)) {
      toast.success(t("readableTranscriptCopied"));
    } else {
      toast.error(t("readableTranscriptCopyFailed"));
    }
  }, [filename, sections, t, title, toast]);

  if (tab === null) return null;

  const current: Tab = hasTranscript ? tab : "summary";
  const tabId = (key: Tab) => `${idBase}-${key}-tab`;
  const panelId = (key: Tab) => `${idBase}-${key}-panel`;
  const items = [
    ...(hasTranscript
      ? [{ key: "transcript", label: t("readableTranscriptTitle"), icon: FileText }]
      : []),
    { key: "summary", label: t("userSummaryTitle"), icon: NotebookText },
  ].map((item) => ({
    ...item,
    id: tabId(item.key as Tab),
    controls: panelId(item.key as Tab),
  }));

  return (
    <section className="reading-measure" aria-label={t("readingSectionLabel")}>
      <PageTabs
        label={t("readingSectionLabel")}
        items={items}
        current={current}
        onSelect={(key) => setTab(key as Tab)}
      />
      {/* Both panels stay mounted so a summary being edited keeps its draft
          while the transcript is read. */}
      <div
        role="tabpanel"
        id={panelId("summary")}
        aria-labelledby={tabId("summary")}
        hidden={current !== "summary"}
        className="pt-4"
      >
        <UserSummaryPanel
          fileId={fileId}
          drive={drive}
          content={summary}
          onSaved={setSummary}
        />
      </div>
      {hasTranscript && (
        <div
          role="tabpanel"
          id={panelId("transcript")}
          aria-labelledby={tabId("transcript")}
          hidden={current !== "transcript"}
          className="pt-4"
        >
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={() => void copy()}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary pointer-coarse:min-h-11"
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
        </div>
      )}
    </section>
  );
}
