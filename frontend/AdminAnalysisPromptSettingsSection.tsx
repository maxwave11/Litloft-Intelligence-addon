"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { useTranslations } from "next-intl";
import { errorDetail, RequestError } from "./llm-settings/api";
import { ApplyMarker } from "./llm-settings/Notices";

const ENDPOINT = "/api/addons/intelligence/admin/analysis-prompt";
const MAX_PROMPT_CHARS = 20_000;

interface PromptPayload {
  prompt: string;
  default: string;
  is_default: boolean;
}

type Outcome = "saved" | "resetSuccess" | null;

async function request(method: "GET" | "PUT" | "DELETE", body?: unknown): Promise<unknown> {
  const resp = await fetch(ENDPOINT, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const parsed = await resp.json();
      if (typeof parsed?.detail === "string") detail = parsed.detail;
    } catch {
      // A body that is not JSON carries no detail worth showing.
    }
    throw new RequestError(resp.status, detail);
  }
  return resp.json().catch(() => null);
}

export default function AdminAnalysisPromptSettingsSection(): React.ReactElement {
  const t = useTranslations("settings.analysisPrompt");
  const [data, setData] = useState<PromptPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const reload = useCallback(async () => {
    const payload = (await request("GET")) as PromptPayload;
    setData(payload);
    setText(payload.prompt);
  }, []);

  useEffect(() => {
    let cancelled = false;
    reload().catch((err: unknown) => {
      if (!cancelled) setLoadError(errorDetail(err, t("loadFailed")));
    });
    return () => {
      cancelled = true;
    };
    // `t` is left out: loading runs once, not whenever the translator is rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  const run = useCallback(
    async (kind: "save" | "reset", fallback: string) => {
      setError(null);
      setOutcome(null);
      setBusy(kind);
      try {
        if (kind === "save") await request("PUT", { prompt: text });
        else await request("DELETE");
        await reload();
        setOutcome(kind === "save" ? "saved" : "resetSuccess");
      } catch (err: unknown) {
        setError(errorDetail(err, fallback));
      } finally {
        setBusy(null);
      }
    },
    [reload, text],
  );

  const frame = "rounded-xl border border-bg-border bg-bg-card p-4";

  if (loadError) {
    return (
      <section className={frame}>
        <h2 className="mb-2 text-base font-semibold text-text-primary">{t("title")}</h2>
        <p className="text-xs text-danger">{loadError}</p>
      </section>
    );
  }
  if (!data) {
    return (
      <section className={frame}>
        <h2 className="mb-2 text-base font-semibold text-text-primary">{t("title")}</h2>
      </section>
    );
  }

  const unchanged = text === data.prompt;

  return (
    <section className={frame}>
      <h2 className="text-base font-semibold text-text-primary">{t("title")}</h2>
      <div className="mb-2 mt-1">
        <ApplyMarker when="now" />
      </div>
      <p className="mb-4 text-xs text-text-muted">{t("description")}</p>

      <label htmlFor="analysis-prompt-text" className="mb-1 block text-sm font-medium">
        {t("promptLabel")}
      </label>
      <textarea
        id="analysis-prompt-text"
        value={text}
        maxLength={MAX_PROMPT_CHARS}
        rows={18}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-2xl border border-warm-silver/40 bg-bg-card px-3 py-2 font-mono text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-focus-ring"
      />
      <p className="mt-1 text-xs text-text-muted">
        {data.is_default ? t("usingDefault") : t("usingCustom")}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          onClick={() => void run("save", t("saveFailed"))}
          disabled={busy !== null || unchanged || text.trim() === ""}
        >
          {busy === "save" ? t("saving") : t("save")}
        </Button>
        {!data.is_default && (
          <Button onClick={() => void run("reset", t("resetFailed"))} disabled={busy !== null}>
            {busy === "reset" ? t("resetting") : t("reset")}
          </Button>
        )}
        {outcome && (
          <span role="status" className="text-xs text-accent-teal">
            {t(outcome)}
          </span>
        )}
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    </section>
  );
}
