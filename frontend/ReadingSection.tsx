"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Copy, FileText, NotebookText, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { listUserSummaries, type UserSummary } from "./api";
import { readableTranscriptMarkdown } from "./readableTranscript";
import { useReadableTranscript } from "./useReadableTranscript";
import UserSummaryPanel from "./UserSummaryPanel";
import { PageTabs } from "@/components/PageTabs";
import { copyText } from "@/lib/copyText";
import { useToast } from "@/components/ToastProvider";
import { useDirty } from "@/hooks/useDirty";
import { useReadingTabHost, useReadingTabs, type ReadingTab } from "@/lib/readingTabs";

const TRANSCRIPT = "transcript";
const NEW = "new";
const summaryKey = (summary: UserSummary) => `summary-${summary.id}`;
const offeredKey = (tab: ReadingTab) => `offered-${tab.id}`;

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
  const [summaries, setSummaries] = useState<UserSummary[]>([]);
  const [summariesLoaded, setSummariesLoaded] = useState(false);
  const [tab, setTab] = useState<string | null>(null);
  const [picked, setPicked] = useState(false);
  const [dirtyKeys, setDirtyKeys] = useState<ReadonlySet<string>>(new Set());

  useDirty({ fileId, source: "user-summary", dirty: dirtyKeys.size > 0 });

  const offered = useReadingTabs(fileId);
  useReadingTabHost(fileId);

  const setDirty = useCallback((key: string, dirty: boolean) => {
    setDirtyKeys((prev) => {
      if (prev.has(key) === dirty) return prev;
      const next = new Set(prev);
      if (dirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSummaries([]);
    setSummariesLoaded(false);
    setTab(null);
    setPicked(false);
    listUserSummaries(fileId, drive)
      .then((list) => {
        if (!cancelled) setSummaries(list);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSummariesLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, drive]);

  const hasTranscript = sections.length > 0;
  const defaultTab =
    summaries.length > 0 ? summaryKey(summaries[0]) : hasTranscript ? TRANSCRIPT : NEW;

  // Chosen once both answers are in, so the page does not open on one tab
  // and jump to the other when the slower request lands.
  useEffect(() => {
    if (tab !== null || !transcriptLoaded || !summariesLoaded) return;
    setTab(defaultTab);
  }, [tab, transcriptLoaded, summariesLoaded, defaultTab]);

  const copy = useCallback(async () => {
    const markdown = readableTranscriptMarkdown(title || filename || "", sections);
    if (await copyText(markdown)) {
      toast.success(t("readableTranscriptCopied"));
    } else {
      toast.error(t("readableTranscriptCopyFailed"));
    }
  }, [filename, sections, t, title, toast]);

  if (tab === null) return null;

  const summaryLabel = (summary: UserSummary, i: number) =>
    summary.title ||
    (summaries.length === 1 ? t("userSummaryTitle") : t("userSummaryNumbered", { n: i + 1 }));
  const items = [
    ...(hasTranscript
      ? [{ key: TRANSCRIPT, label: t("readableTranscriptTitle"), icon: FileText }]
      : []),
    ...summaries.map((summary, i) => ({
      key: summaryKey(summary),
      label: summaryLabel(summary, i),
      icon: NotebookText,
    })),
    ...offered.map((tab) => ({ key: offeredKey(tab), label: tab.label, icon: tab.icon })),
    { key: NEW, label: t("userSummaryNew"), icon: Plus },
  ].map((item) => ({
    ...item,
    id: `${idBase}-${item.key}-tab`,
    controls: `${idBase}-${item.key}-panel`,
  }));
  const current = items.some((item) => item.key === tab) ? tab : defaultTab;

  const panelProps = (key: string) => ({
    role: "tabpanel",
    id: `${idBase}-${key}-panel`,
    "aria-labelledby": `${idBase}-${key}-tab`,
    hidden: current !== key,
    className: "pt-4",
  });

  return (
    <section className="reading-measure" aria-label={t("readingSectionLabel")}>
      <PageTabs
        label={t("readingSectionLabel")}
        items={items}
        current={current}
        onSelect={(key) => {
          setPicked(true);
          setTab(key);
        }}
      />
      {/* Every panel stays mounted so a summary being edited keeps its draft
          while another tab is open. */}
      {summaries.map((summary) => {
        const key = summaryKey(summary);
        return (
          <div key={key} {...panelProps(key)}>
            <UserSummaryPanel
              fileId={fileId}
              drive={drive}
              summary={summary}
              onDirtyChange={(dirty) => setDirty(key, dirty)}
              onSaved={(next) => {
                if (next) {
                  setSummaries((prev) => prev.map((s) => (s.id === next.id ? next : s)));
                } else {
                  setDirty(key, false);
                  setSummaries((prev) => prev.filter((s) => s.id !== summary.id));
                  setTab(null);
                }
              }}
            />
          </div>
        );
      })}
      <div {...panelProps(NEW)}>
        <UserSummaryPanel
          fileId={fileId}
          drive={drive}
          summary={null}
          focus={picked && current === NEW}
          onDirtyChange={(dirty) => setDirty(NEW, dirty)}
          onSaved={(next) => {
            if (!next) return;
            setSummaries((prev) => [...prev, next]);
            setTab(summaryKey(next));
          }}
        />
      </div>
      {offered.map((tab) => (
        <div key={offeredKey(tab)} {...panelProps(offeredKey(tab))}>
          {tab.panel}
        </div>
      ))}
      {hasTranscript && (
        <div {...panelProps(TRANSCRIPT)}>
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
