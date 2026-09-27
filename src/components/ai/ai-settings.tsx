"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/lib/i18n";
import { AI_MODELS, modelLabel, type AiModelId } from "@/lib/ai/models";
import { AiError, fetchAiStatus, setApiKey, setModel, streamChat, useAiApiKey, useAiModel } from "@/lib/ai/client";

type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; detail: string }
  | { kind: "fail"; detail: string };

export function AiSettings() {
  const t = useT();
  const stored = useAiApiKey();
  const model = useAiModel();
  const [edit, setEdit] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [serverKey, setServerKey] = useState<boolean | null>(null);
  const [test, setTest] = useState<TestState>({ kind: "idle" });

  const draft = edit ?? stored;
  const dirty = draft.trim() !== stored;

  useEffect(() => {
    let alive = true;
    fetchAiStatus()
      .then((s) => alive && setServerKey(s.serverKey))
      .catch(() => alive && setServerKey(false));
    return () => {
      alive = false;
    };
  }, []);

  function save() {
    setApiKey(draft);
    setEdit(null);
    toast.success(draft.trim() ? t("API key saved in this browser") : t("API key removed"));
  }

  function clear() {
    setApiKey("");
    setEdit(null);
    setTest({ kind: "idle" });
    toast.success(t("API key removed from this browser"));
  }

  async function runTest() {
    if (dirty) save();
    setTest({ kind: "running" });
    try {
      const text = await streamChat(
        {
          model,
          // Sent to the model: stays English.
          system: "You are a connectivity check. Reply with exactly: OK",
          messages: [{ role: "user", content: "ping" }],
          maxTokens: 256,
        },
        () => {},
      );
      setTest({ kind: "ok", detail: t('{model} replied "{reply}".', { model: modelLabel(model), reply: text.trim().slice(0, 40) || "…" }) });
    } catch (err) {
      setTest({ kind: "fail", detail: err instanceof AiError ? err.message : t("Unexpected error.") });
    }
  }

  const selectedModel = AI_MODELS.find((m) => m.id === model);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("AI assistant")}</CardTitle>
        <CardDescription>{t("The one feature that sends data off this device. Off until you add a key, and nothing is sent until you press send.")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="ai-key">{t("Anthropic API key")}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="ai-key"
              type={show ? "text" : "password"}
              value={draft}
              onChange={(e) => setEdit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && dirty) {
                  e.preventDefault();
                  save();
                }
              }}
              placeholder="sk-ant-…"
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              className="font-mono"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? t("Hide key") : t("Show key")}
            >
              {show ? <EyeOff /> : <Eye />}
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={!dirty}>
              {t("Save")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={clear} disabled={!stored && !draft}>
              {t("Clear")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("Saved locally in this browser only. It is never written to the workspace database, so it stays out of exports and backups.")}
          </p>
          {serverKey ? (
            <p className="text-xs text-muted-foreground">{t("This deployment provides a server-side key, so you can leave this empty. A key here takes precedence.")}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="ai-model">{t("Model")}</Label>
          <Select value={model} onValueChange={(v) => setModel(v as AiModelId)}>
            <SelectTrigger id="ai-model" className="min-w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AI_MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label} <span className="text-muted-foreground">· {t(m.hint)}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedModel ? (
            <p className="text-xs text-muted-foreground">
              {t(selectedModel.cost)}. {t("Billed to your key.")}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={runTest}
              disabled={test.kind === "running" || (!draft.trim() && !serverKey)}
            >
              {test.kind === "running" ? <Loader2 className="animate-spin" /> : null}
              {t("Test connection")}
            </Button>
            {test.kind === "ok" ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-[var(--viz-good)]">
                <CheckCircle2 className="size-4" /> {t("Connected.")} {test.detail}
              </span>
            ) : test.kind === "fail" ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-destructive">
                <XCircle className="size-4" /> {test.detail}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{t("Sends one tiny request (a few tokens) with the model above.")}</p>
        </div>

        <div className="space-y-2 text-sm">
          <h3 className="font-medium">{t("What leaves your browser")}</h3>
          <p className="text-muted-foreground">
            {t(
              "Keel keeps everything in this browser. When you press send in the assistant, only the context listed in the panel goes to Anthropic's API through this site's relay: the workspace overview, the attached note or project, the vault excerpts matched to your question, and the conversation so far. The relay forwards your key with that one request and keeps nothing. Close the panel and nothing else is ever sent.",
            )}
          </p>
        </div>

        <div className="space-y-2 text-sm">
          <h3 className="font-medium">{t("Self-hosting with one shared key")}</h3>
          <p className="text-muted-foreground">
            {t("Operators can provide a key for everyone on their own instance by setting both variables. The key alone is ignored, so a public deployment cannot spend the operator's credits by accident.")}
          </p>
          <pre className="overflow-auto rounded-md bg-muted p-3 font-mono text-xs" dir="ltr">
            {"ANTHROPIC_API_KEY=sk-ant-…\nKEEL_ALLOW_SERVER_KEY=true"}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
