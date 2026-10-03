"use client";

import { useState } from "react";
import { Pencil, Plus, RefreshCw, Save, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { saveUserSummary } from "./api";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { useToast } from "@/components/ToastProvider";
import { useDirty } from "@/hooks/useDirty";

const ACTION_CLASS =
  "flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary disabled:opacity-50 pointer-coarse:min-h-11";

interface UserSummaryPanelProps {
  fileId: string;
  drive: string;
  content: string | null;
  onSaved: (content: string | null) => void;
}

export default function UserSummaryPanel({
  fileId,
  drive,
  content,
  onSaved,
}: UserSummaryPanelProps) {
  const t = useTranslations("searchIndex");
  const toast = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const editing = draft !== null;
  const changed = editing && draft.trim() !== (content ?? "");
  useDirty({ fileId, source: "user-summary", dirty: changed });

  const save = async () => {
    if (draft === null || saving) return;
    setSaving(true);
    try {
      const res = await saveUserSummary(fileId, drive, draft);
      onSaved(res.available ? (res.content ?? null) : null);
      setDraft(null);
    } catch {
      toast.error(t("userSummarySaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div>
        <textarea
          aria-label={t("userSummaryEditLabel")}
          placeholder={t("userSummaryPlaceholder")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void save();
            } else if (e.key === "Escape" && !changed) {
              setDraft(null);
            }
          }}
          rows={Math.max(8, draft.split("\n").length + 1)}
          spellCheck={false}
          autoFocus
          className="block w-full resize-y rounded-lg border border-bg-border bg-bg-card px-3 py-2.5 font-mono text-[13.5px] leading-relaxed text-text-primary outline-none focus:border-focus-ring"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !changed}
            className="flex items-center gap-1 rounded-lg bg-accent-teal px-2 py-1 text-xs text-white transition-colors hover:bg-accent-teal/90 disabled:opacity-50 pointer-coarse:min-h-11"
          >
            {saving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
            {t("userSummarySave")}
          </button>
          <button
            type="button"
            onClick={() => setDraft(null)}
            disabled={saving}
            className={ACTION_CLASS}
          >
            <X size={12} />
            {t("userSummaryCancel")}
          </button>
        </div>
      </div>
    );
  }

  if (content === null) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-text-muted">{t("userSummaryEmpty")}</p>
        <button type="button" onClick={() => setDraft("")} className={ACTION_CLASS}>
          <Plus size={12} />
          {t("userSummaryAdd")}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button type="button" onClick={() => setDraft(content)} className={ACTION_CLASS}>
          <Pencil size={12} />
          {t("userSummaryEdit")}
        </button>
      </div>
      <MarkdownPreview
        source={content}
        chrome={false}
        mermaid={false}
        showFrontmatter={false}
        drive={drive}
        className="text-base leading-relaxed text-text-primary"
      />
    </div>
  );
}
