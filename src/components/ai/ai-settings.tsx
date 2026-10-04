"use client";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, Eye, EyeOff, Loader2, RefreshCw, WifiOff, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMounted } from "@/hooks/use-mounted";
import { useT } from "@/lib/i18n";
import { defaultModelFor, providerById, type ProviderId } from "@/lib/ai/providers";
import {
  AiError,
  configLabel,
  fetchAiStatus,
  fetchModels,
  isAiReady,
  resolveTransport,
  setApiKey,
  setBaseUrl,
  setModel,
  setProvider,
  setTransport,
  streamChat,
  useAiConfig,
  type Transport,
} from "@/lib/ai/client";

type TestState = { kind: "idle" } | { kind: "running" } | { kind: "ok"; detail: string } | { kind: "fail"; detail: string };

const GROUPS: { label: string; ids: ProviderId[] }[] = [
  { label: "Cloud", ids: ["anthropic", "openai", "gemini", "openrouter", "groq", "mistral", "deepseek", "xai"] },
  { label: "On this computer (offline)", ids: ["ollama", "lmstudio"] },
  { label: "Any other endpoint", ids: ["custom"] },
];

export function AiSettings() {
  const t = useT();
  const mounted = useMounted();
  const cfg = useAiConfig();
  const def = cfg.def;
  const [keyEdit, setKeyEdit] = useState<string | null>(null);
  const [urlEdit, setUrlEdit] = useState<string | null>(null);
  const [modelEdit, setModelEdit] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [serverKeys, setServerKeys] = useState<string[]>([]);
  const [models, setModels] = useState<{ provider: ProviderId; ids: string[] } | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: "idle" });

  const keyDraft = keyEdit ?? cfg.apiKey;
  const urlDraft = urlEdit ?? cfg.baseUrl;
  const modelDraft = modelEdit ?? cfg.model;
  const keyDirty = keyDraft.trim() !== cfg.apiKey;
  const hasServerKey = serverKeys.includes(cfg.provider);
  const transport = mounted ? resolveTransport(cfg) : "relay";
  const origin = mounted ? window.location.origin : "https://your-keel.example";
  const suggestions = useMemo(() => {
    const loaded = models?.provider === cfg.provider ? models.ids : [];
    return [...new Set([...def.models.map((m) => m.id), ...loaded])];
  }, [models, cfg.provider, def.models]);

  useEffect(() => {
    let alive = true;
    fetchAiStatus()
      .then((s) => alive && setServerKeys(s.serverKeys))
      .catch(() => alive && setServerKeys([]));
    return () => {
      alive = false;
    };
  }, []);

  function pickProvider(id: string) {
    setProvider(id as ProviderId);
    setKeyEdit(null);
    setUrlEdit(null);
    setModelEdit(null);
    setShow(false);
    setTest({ kind: "idle" });
  }

  function saveKey() {
    setApiKey(keyDraft);
    setKeyEdit(null);
    toast.success(keyDraft.trim() ? t("API key saved in this browser") : t("API key removed"));
  }

  function commitUrl() {
    if (urlEdit === null) return;
    setBaseUrl(urlEdit);
    setUrlEdit(null);
  }

  function commitModel(v = modelDraft) {
    setModel(v);
    setModelEdit(null);
  }

  async function loadModels() {
    if (keyDirty) saveKey();
    commitUrl();
    setLoadingModels(true);
    try {
      const ids = await fetchModels({ ...cfg, apiKey: keyDraft.trim(), baseUrl: urlDraft.trim() || cfg.baseUrl });
      setModels({ provider: cfg.provider, ids });
      toast.success(t("{n} models found", { n: ids.length }));
      if (!cfg.model && ids[0]) commitModel(ids[0]);
    } catch (err) {
      toast.error(t("Could not list models"), { description: err instanceof AiError ? err.message : String(err) });
    } finally {
      setLoadingModels(false);
    }
  }

  async function runTest() {
    if (keyDirty) saveKey();
    commitUrl();
    if (modelEdit !== null) commitModel();
    setTest({ kind: "running" });
    const config = { ...cfg, apiKey: keyDraft.trim(), baseUrl: urlDraft.trim() || cfg.baseUrl, model: modelDraft.trim() };
    try {
      const text = await streamChat(
        {
          config,
          // Sent to the model: stays English.
          system: "You are a connectivity check. Reply with exactly: OK",
          messages: [{ role: "user", content: "ping" }],
          maxTokens: 256,
        },
        () => {},
      );
      setTest({ kind: "ok", detail: t('{model} replied "{reply}".', { model: configLabel(config), reply: text.trim().slice(0, 40) || "…" }) });
    } catch (err) {
      setTest({ kind: "fail", detail: err instanceof AiError ? err.message : t("Unexpected error.") });
    }
  }

  const ready = isAiReady({ ...cfg, apiKey: keyDraft.trim(), model: modelDraft.trim(), baseUrl: urlDraft.trim() || cfg.baseUrl }, serverKeys);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("AI assistant")}</CardTitle>
        <CardDescription>
          {t("Use any model: Claude, GPT, Gemini, open models through OpenRouter or Groq, or a model running on your own computer that works with no internet at all. Off until you set it up, and nothing is sent until you press send.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="ai-provider">{t("Provider")}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={cfg.provider} onValueChange={pickProvider}>
              <SelectTrigger id="ai-provider" className="min-w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROUPS.map((g) => (
                  <SelectGroup key={g.label}>
                    <SelectLabel>{t(g.label)}</SelectLabel>
                    {g.ids.map((id) => {
                      const p = providerById(id)!;
                      return (
                        <SelectItem key={id} value={id}>
                          {t(p.label)}
                        </SelectItem>
                      );
                    })}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            {def.local ? (
              <Badge variant="secondary" className="gap-1 font-normal">
                <WifiOff className="size-3" /> {t("Works offline")}
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{t(def.blurb)}</p>
        </div>

        {def.editableUrl ? (
          <div className="space-y-2">
            <Label htmlFor="ai-url">{t("Endpoint URL")}</Label>
            <Input
              id="ai-url"
              value={urlDraft}
              onChange={(e) => setUrlEdit(e.target.value)}
              onBlur={commitUrl}
              onKeyDown={(e) => e.key === "Enter" && commitUrl()}
              placeholder={def.baseUrl || "https://api.example.com/v1"}
              spellCheck={false}
              dir="ltr"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">{t("The base URL of an OpenAI-compatible API, ending before /chat/completions.")}</p>
          </div>
        ) : null}

        {def.keyRequired || def.id === "custom" ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="ai-key">{t("{provider} API key", { provider: def.label.replace(/ \(.*\)$/, "") })}</Label>
              {def.keyUrl ? (
                <a href={def.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
                  {t("Get a key")} <ExternalLink className="size-3" />
                </a>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Input
                id="ai-key"
                type={show ? "text" : "password"}
                value={keyDraft}
                onChange={(e) => setKeyEdit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && keyDirty) {
                    e.preventDefault();
                    saveKey();
                  }
                }}
                placeholder={def.keyPlaceholder ?? ""}
                autoComplete="off"
                spellCheck={false}
                dir="ltr"
                className="font-mono"
              />
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => setShow((s) => !s)} aria-label={show ? t("Hide key") : t("Show key")}>
                {show ? <EyeOff /> : <Eye />}
              </Button>
              <Button type="button" size="sm" onClick={saveKey} disabled={!keyDirty}>
                {t("Save")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setApiKey("");
                  setKeyEdit(null);
                  setTest({ kind: "idle" });
                  toast.success(t("API key removed from this browser"));
                }}
                disabled={!cfg.apiKey && !keyDraft}
              >
                {t("Clear")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("Saved locally in this browser only, one key per provider. It is never written to the workspace database, so it stays out of exports and backups.")}
            </p>
            {hasServerKey ? <p className="text-xs text-muted-foreground">{t("This deployment provides a server-side key, so you can leave this empty. A key here takes precedence.")}</p> : null}
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="ai-model">{t("Model")}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="ai-model"
              list="ai-model-list"
              value={modelDraft}
              onChange={(e) => setModelEdit(e.target.value)}
              onBlur={() => modelEdit !== null && commitModel()}
              onKeyDown={(e) => e.key === "Enter" && commitModel()}
              placeholder={def.models[0]?.id ?? t("model id")}
              spellCheck={false}
              dir="ltr"
              className="max-w-80 font-mono"
            />
            <datalist id="ai-model-list">
              {suggestions.map((id) => (
                <option key={id} value={id}>
                  {def.models.find((m) => m.id === id)?.label ?? id}
                </option>
              ))}
            </datalist>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadModels()} disabled={loadingModels || (def.keyRequired && !keyDraft.trim())}>
              {loadingModels ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t("Load models")}
            </Button>
          </div>
          {def.models.length ? (
            <div className="flex flex-wrap gap-1.5">
              {def.models.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => commitModel(m.id)}
                  className={`rounded-full border px-2 py-0.5 text-xs ${cfg.model === m.id ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                >
                  {m.label}
                  {m.hint ? <span className="opacity-70"> · {t(m.hint)}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {def.local ? t("Any model you have pulled. Bigger models answer better; tool use (creating issues and so on) needs a model that supports tools, such as Qwen 3.6, Gemma 4 or Llama 3.1.") : t("Type any model id the provider offers, or load the list. Billed to your key by the provider.")}
          </p>
        </div>

        {!def.editableUrl ? (
          <div className="space-y-2">
            <Label htmlFor="ai-transport">{t("Connection")}</Label>
            <Select value={cfg.transport} onValueChange={(v) => setTransport(v as Transport)}>
              <SelectTrigger id="ai-transport" className="min-w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t("Through this site's relay (recommended)")}</SelectItem>
                <SelectItem value="direct">{t("Directly from this browser")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {transport === "direct"
                ? t("Your browser calls {provider} itself; the key never reaches this site's server.", { provider: def.label.replace(/ \(.*\)$/, "") })
                : t("The relay forwards your key with each request and keeps nothing. Use direct if you would rather it never touched the server.")}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {transport === "relay"
              ? t("Keel runs on this machine, so its own server talks to the model: no browser set-up needed.")
              : t("Your browser talks to the model directly, so it keeps working with no internet once this page is installed.")}
          </p>
        )}

        {def.id === "ollama" ? <OllamaHelp origin={origin} needsOrigin={transport === "direct"} model={cfg.model.trim() || defaultModelFor(def)} /> : null}
        {def.id === "lmstudio" ? (
          <ol className="list-decimal space-y-1 ps-5 text-sm text-muted-foreground">
            <li>{t("In LM Studio, open the Developer tab, load a model and start the server (port 1234).")}</li>
            {transport === "direct" ? <li>{t('Turn on "Enable CORS" in the server settings so this page may call it.')}</li> : null}
            <li>{t("Press Load models, pick the loaded one, then Test connection.")}</li>
          </ol>
        ) : null}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void runTest()} disabled={test.kind === "running" || !ready}>
              {test.kind === "running" ? <Loader2 className="animate-spin" /> : null}
              {t("Test connection")}
            </Button>
            {test.kind === "ok" ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-[var(--viz-good-text)]">
                <CheckCircle2 className="size-4" /> {t("Connected.")} {test.detail}
              </span>
            ) : test.kind === "fail" ? (
              <span className="inline-flex items-start gap-1.5 text-sm text-destructive">
                <XCircle className="mt-0.5 size-4 shrink-0" /> {test.detail}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{t("Sends one tiny request (a few tokens) with the model above.")}</p>
        </div>

        <div className="space-y-2 text-sm">
          <h3 className="font-medium">{t("What leaves your browser")}</h3>
          <p className="text-muted-foreground">
            {def.local
              ? t("Nothing leaves your computer. The assistant sends the context listed in the panel to the model running on this machine, and the answer comes back the same way.")
              : t(
                  "Keel keeps everything in this browser. When you press send in the assistant, only the context listed in the panel goes to {provider}: the workspace overview, the attached note or project, the vault excerpts matched to your question, and the conversation so far. Close the panel and nothing else is ever sent.",
                  { provider: def.label.replace(/ \(.*\)$/, "") },
                )}
          </p>
        </div>

        <div className="space-y-2 text-sm">
          <h3 className="font-medium">{t("Self-hosting with one shared key")}</h3>
          <p className="text-muted-foreground">
            {t("Operators can provide a key for everyone on their own instance by setting the provider's variable and the opt-in. The key alone is ignored, so a public deployment cannot spend the operator's credits by accident.")}
          </p>
          <pre className="overflow-auto rounded-md bg-muted p-3 font-mono text-xs" dir="ltr">
            {"KEEL_ALLOW_SERVER_KEY=true\nANTHROPIC_API_KEY=…   # or OPENAI_API_KEY, GEMINI_API_KEY,\n                      # OPENROUTER_API_KEY, GROQ_API_KEY,\n                      # MISTRAL_API_KEY, DEEPSEEK_API_KEY, XAI_API_KEY"}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}

function OllamaHelp({ origin, needsOrigin, model }: { origin: string; needsOrigin: boolean; model: string }) {
  const t = useT();
  const cmd = [needsOrigin ? `OLLAMA_ORIGINS=${origin}` : null, "OLLAMA_CONTEXT_LENGTH=16384", "ollama serve"].filter(Boolean).join(" ");
  return (
    <div className="space-y-2 text-sm">
      <h3 className="font-medium">{t("Set up Ollama (one time)")}</h3>
      <ol className="list-decimal space-y-1 ps-5 text-muted-foreground">
        <li>
          {t("Install Ollama from")}{" "}
          <a href="https://ollama.com/download" target="_blank" rel="noreferrer" className="underline">
            ollama.com
          </a>{" "}
          {t("and pull a model that supports tools:")}
        </li>
      </ol>
      <pre className="overflow-auto rounded-md bg-muted p-3 font-mono text-xs" dir="ltr">
        {`ollama pull ${model}`}
      </pre>
      <ol start={2} className="list-decimal space-y-1 ps-5 text-muted-foreground">
        <li>
          {needsOrigin
            ? t("Start it so this page may call it, with a context long enough for your notes:")
            : t("Start it with a context long enough for your notes:")}
        </li>
      </ol>
      <pre className="overflow-auto rounded-md bg-muted p-3 font-mono text-xs" dir="ltr">
        {cmd}
      </pre>
      <p className="text-xs text-muted-foreground">
        {needsOrigin
          ? t("On a Mac running the Ollama app, set the variable with launchctl setenv OLLAMA_ORIGINS {origin} and restart the app. Chrome may ask once to allow this site to reach devices on your local network.", { origin })
          : t("The default context of a few thousand tokens cuts long notes short; 16k is a good minimum.")}
      </p>
    </div>
  );
}
