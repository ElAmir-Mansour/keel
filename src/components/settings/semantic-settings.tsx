"use client";
import { Sparkles } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EMBEDDING_MODELS, type EmbeddingModelId } from "@/lib/ai/embeddings";
import { setSemanticEnabled, setSemanticModel, useSemanticStatus } from "@/lib/ai/semantic";

export function SemanticSettings() {
  const s = useSemanticStatus();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Find notes by meaning, not just words: &ldquo;what blocked the release&rdquo; finds the post-mortem that never uses the word blocked. The model runs in your browser; nothing leaves the device. Switching it on downloads the model once and indexes the vault in the background; the assistant and the search palette then use it.
      </p>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-2">
          <Switch checked={s.enabled} onCheckedChange={(v) => void setSemanticEnabled(v)} /> Semantic search
        </label>
        <Select value={s.model} onValueChange={(v) => void setSemanticModel(v as EmbeddingModelId)}>
          <SelectTrigger size="sm" className="w-auto" aria-label="Embedding model">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EMBEDDING_MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {s.enabled ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3.5" />
            {s.loading ? `Downloading model… ${Math.round(s.loadProgress * 100)}%` : s.indexing ? `Indexing ${s.indexed} of ${s.total}` : s.ready ? `Ready · ${s.total} records indexed` : "Starting…"}
          </span>
        ) : null}
      </div>
      {s.enabled && (s.loading || s.indexing) ? <Progress value={s.loading ? s.loadProgress * 100 : s.total ? (s.indexed / s.total) * 100 : 0} className="h-1.5 w-72" /> : null}
      {s.error ? <p className="text-xs text-[var(--viz-critical)]">{s.error}</p> : null}
    </div>
  );
}
