"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, RefreshCw, Save, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { createUserSummary, updateUserSummary, type UserSummary } from "./api";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { useToast } from "@/components/ToastProvider";

const ACTION_CLASS =
  "flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary disabled:opacity-50 pointer-coarse:min-h-11";

const FIELD_CLASS =
  "block w-full rounded-lg border border-bg-border bg-bg-card px-3 text-text-primary outline-none focus:border-focus-ring";

const EMPTY = { title: "", content: "" };

interface UserSummaryPanelProps {
  fileId: string;
  drive: string;
  /** `null` is the panel that adds a new summary: always an open editor. */
  summary: UserSummary | null;
  /** Moves the caret into the editor; set when the viewer opens the panel. */
  focus?: boolean;
  /** `null` after the summary was deleted by saving it empty. */
  onSaved: (next: UserSummary | null) => void;
  onDirtyChange: (dirty: boolean) => void;
}

export default function UserSummaryPanel({
  fileId,
  drive,
  summary,
  focus = false,
  onSaved,
  onDirtyChange,
}: UserSummaryPanelProps) {
  const t = useTranslations("searchIndex");
  const toast = useToast();
  const [draft, setDraft] = useState<typeof EMPTY | null>(null);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isNew = summary === null;
  const editing = isNew || draft !== null;
  const current = draft ?? EMPTY;
  const saved = isNew ? EMPTY : { title: summary.title ?? "", content: summary.content };
  const changed =
    editing &&
    (current.content.trim() !== saved.content || current.title.trim() !== saved.title);
  const canSave = changed && !(isNew && current.content.trim() === "");

  useEffect(() => {
    onDirtyChange(changed);
  }, [changed, onDirtyChange]);

  useEffect(() => {
    if (focus) textareaRef.current?.focus();
  }, [focus]);

  const close = () => setDraft(null);

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const body = { title: current.title.trim(), content: current.content };
      const next = isNew
        ? await createUserSummary(fileId, drive, body)
        : await updateUserSummary(fileId, drive, summary.id, body);
      close();
      onSaved(next);
    } catch {
      toast.error(t("userSummarySaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div>
        <div className="mb-2 flex justify-end">
          <button type="button" onClick={() => setDraft(saved)} className={ACTION_CLASS}>
            <Pencil size={12} />
            {t("userSummaryEdit")}
          </button>
        </div>
        <MarkdownPreview
          source={summary.content}
          chrome={false}
          mermaid={false}
          showFrontmatter={false}
          drive={drive}
          className="text-base leading-relaxed text-text-primary"
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        type="text"
        aria-label={t("userSummaryTitleLabel")}
        placeholder={t("userSummaryTitlePlaceholder")}
        value={current.title}
        maxLength={100}
        onChange={(e) => setDraft({ ...current, title: e.target.value })}
        className={`${FIELD_CLASS} h-9 text-sm pointer-coarse:h-11`}
      />
      <textarea
        ref={textareaRef}
        aria-label={t("userSummaryEditLabel")}
        placeholder={t("userSummaryPlaceholder")}
        value={current.content}
        onChange={(e) => setDraft({ ...current, content: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape" && !changed && !isNew) {
            close();
          }
        }}
        rows={Math.max(8, current.content.split("\n").length + 1)}
        spellCheck={false}
        autoFocus={!isNew}
        className={`${FIELD_CLASS} resize-y py-2.5 font-mono text-[13.5px] leading-relaxed`}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !canSave}
          className="flex items-center gap-1 rounded-lg bg-accent-teal px-2 py-1 text-xs text-white transition-colors hover:bg-accent-teal/90 disabled:opacity-50 pointer-coarse:min-h-11"
        >
          {saving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
          {t("userSummarySave")}
        </button>
        <button
          type="button"
          onClick={close}
          disabled={saving || (isNew && !changed)}
          className={ACTION_CLASS}
        >
          <X size={12} />
          {t("userSummaryCancel")}
        </button>
      </div>
    </div>
  );
}
