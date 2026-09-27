"use client";
import { Sparkles } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/lib/i18n";
import { EMBEDDING_MODELS, type EmbeddingModelId } from "@/lib/ai/embeddings";
import { setSemanticEnabled, setSemanticModel, useSemanticStatus } from "@/lib/ai/semantic";

export function SemanticSettings() {
  const t = useT();
  const s = useSemanticStatus();
  const status = s.loading
    ? t("Downloading model… {pct}%", { pct: Math.round(s.loadProgress * 100) })
    : s.indexing
      ? t("Indexing {done} of {total}", { done: s.indexed, total: s.total })
      : s.ready
        ? t("Ready · {n} records indexed", { n: s.total })
        : t("Starting…");
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t("Find notes by meaning, not just words: “what blocked the release” finds the post-mortem that never uses the word blocked. The model runs in your browser; nothing leaves the device. Switching it on downloads the model once and indexes the vault in the background; the assistant and the search palette then use it.")}
      </p>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-2">
          <Switch checked={s.enabled} onCheckedChange={(v) => void setSemanticEnabled(v)} /> {t("Semantic search")}
        </label>
        <Select value={s.model} onValueChange={(v) => void setSemanticModel(v as EmbeddingModelId)}>
          <SelectTrigger size="sm" className="w-auto" aria-label={t("Embedding model")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EMBEDDING_MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {t(m.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {s.enabled ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3.5" />
            {status}
          </span>
        ) : null}
      </div>
      {s.enabled && (s.loading || s.indexing) ? <Progress value={s.loading ? s.loadProgress * 100 : s.total ? (s.indexed / s.total) * 100 : 0} className="h-1.5 w-72" /> : null}
      {s.error ? <p className="text-xs text-[var(--viz-critical)]">{s.error}</p> : null}
    </div>
  );
}
