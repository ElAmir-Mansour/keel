import { useSyncExternalStore } from "react";
import { ProviderError, listModels as listProviderModels, streamProvider, type ProviderCall } from "./adapters";
import {
  API_KEY_HEADER,
  STORAGE_KEYS,
  isAiErrorCode,
  type AiChatMessage,
  type AiErrorCode,
  type AiRequestBody,
} from "./models";
import { JSON_ONLY_INSTRUCTION } from "./prompts";
import { DEFAULT_PROVIDER, defaultModelFor, isPrivateHost, isProviderId, modelLabelFor, normalizeBaseUrl, providerById, type ProviderDef, type ProviderId } from "./providers";
import { toolByName } from "./tools";
import { TurnAccumulator, type ToolCall, type TurnResult } from "./turn";

// Browser side of the assistant. The provider, its key, model and endpoint
// live in localStorage (never in IndexedDB, so they stay out of the JSON
// export), one slot per provider so switching back and forth keeps each key.
// Every call goes through streamTurn, which either posts to this site's relay
// or, for local and custom endpoints when Keel is served from the web, calls
// the provider straight from the browser.

export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AiError";
  }
}

// ----- settings store ----------------------------------------------------------

const listeners = new Set<() => void>();

function read(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Private mode or blocked storage: the value simply does not persist.
  }
  snapshot = null;
  for (const l of listeners) l();
}

let migrated = false;
/** Keys and models saved before providers existed belong to Anthropic. */
function migrate() {
  if (migrated || typeof window === "undefined") return;
  migrated = true;
  const legacyKey = read(STORAGE_KEYS.legacyKey);
  if (legacyKey && !read(STORAGE_KEYS.key("anthropic"))) {
    try {
      window.localStorage.setItem(STORAGE_KEYS.key("anthropic"), legacyKey);
      window.localStorage.removeItem(STORAGE_KEYS.legacyKey);
    } catch {
      /* ignore */
    }
  }
  const legacyModel = read(STORAGE_KEYS.legacyModel);
  if (legacyModel && !read(STORAGE_KEYS.model("anthropic"))) {
    try {
      window.localStorage.setItem(STORAGE_KEYS.model("anthropic"), legacyModel);
      window.localStorage.removeItem(STORAGE_KEYS.legacyModel);
    } catch {
      /* ignore */
    }
  }
}

export type Transport = "auto" | "relay" | "direct";

export interface AiConfig {
  provider: ProviderId;
  def: ProviderDef;
  model: string;
  apiKey: string;
  baseUrl: string;
  transport: Transport;
}

export function getProvider(): ProviderId {
  migrate();
  const v = read(STORAGE_KEYS.provider);
  return isProviderId(v) ? v : DEFAULT_PROVIDER;
}

export function setProvider(p: ProviderId) {
  write(STORAGE_KEYS.provider, p);
}

export function getApiKey(provider: ProviderId = getProvider()) {
  migrate();
  return read(STORAGE_KEYS.key(provider)) ?? "";
}

export function setApiKey(key: string, provider: ProviderId = getProvider()) {
  write(STORAGE_KEYS.key(provider), key.trim() || null);
}

export function getModel(provider: ProviderId = getProvider()) {
  migrate();
  const def = providerById(provider)!;
  return read(STORAGE_KEYS.model(provider)) || defaultModelFor(def);
}

export function setModel(model: string, provider: ProviderId = getProvider()) {
  write(STORAGE_KEYS.model(provider), model.trim() || null);
}

export function getBaseUrl(provider: ProviderId = getProvider()) {
  const def = providerById(provider)!;
  if (!def.editableUrl) return def.baseUrl;
  return read(STORAGE_KEYS.baseUrl(provider)) || def.baseUrl;
}

export function setBaseUrl(url: string, provider: ProviderId = getProvider()) {
  write(STORAGE_KEYS.baseUrl(provider), url.trim() || null);
}

export function getTransport(): Transport {
  const v = read(STORAGE_KEYS.transport);
  return v === "relay" || v === "direct" ? v : "auto";
}

export function setTransport(t: Transport) {
  write(STORAGE_KEYS.transport, t === "auto" ? null : t);
}

const SERVER_CONFIG: AiConfig = {
  provider: DEFAULT_PROVIDER,
  def: providerById(DEFAULT_PROVIDER)!,
  model: defaultModelFor(providerById(DEFAULT_PROVIDER)!),
  apiKey: "",
  baseUrl: providerById(DEFAULT_PROVIDER)!.baseUrl,
  transport: "auto",
};

let snapshot: AiConfig | null = null;

export function getAiConfig(): AiConfig {
  if (snapshot) return snapshot;
  const provider = getProvider();
  snapshot = { provider, def: providerById(provider)!, model: getModel(provider), apiKey: getApiKey(provider), baseUrl: getBaseUrl(provider), transport: getTransport() };
  return snapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (!e.key || e.key.startsWith("keel.ai.")) {
      snapshot = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Live view of the assistant settings; the server snapshot is the default so hydration matches. */
export function useAiConfig(): AiConfig {
  return useSyncExternalStore(subscribe, getAiConfig, () => SERVER_CONFIG);
}

/** Display name for the chosen model, e.g. "Claude Opus 5.5" or "llama3.1 · Ollama". */
export function configLabel(c: AiConfig) {
  const label = modelLabelFor(c.def, c.model) || c.def.label;
  return c.def.local || c.def.id === "custom" ? `${label} · ${c.def.label.replace(/ \(.*\)$/, "")}` : label;
}

/** Whether the assistant can be used without further set-up (a key, or a local model). */
export function isAiReady(c: AiConfig = getAiConfig(), serverKeys: readonly string[] = []) {
  if (!c.model.trim()) return false;
  if (c.def.keyRequired) return Boolean(c.apiKey) || serverKeys.includes(c.provider);
  return Boolean(normalizeBaseUrl(c.baseUrl));
}

function pageIsLocal() {
  try {
    return isPrivateHost(window.location.hostname);
  } catch {
    return false;
  }
}

/**
 * Relay or direct. The relay is the default for cloud providers. Local and
 * custom endpoints go through the relay only when Keel itself runs on this
 * machine; from the web they are called directly, which also keeps working
 * when the network is gone.
 */
export function resolveTransport(c: AiConfig = getAiConfig()): "relay" | "direct" {
  if (c.transport === "relay" && !c.def.editableUrl) return "relay";
  if (c.transport === "direct") return "direct";
  if (c.def.editableUrl) return pageIsLocal() ? "relay" : "direct";
  return "relay";
}

// ----- transport ---------------------------------------------------------------

export interface StreamChatOptions {
  system: string;
  messages: AiChatMessage[];
  /** Overrides for a one-off call such as the connection test. */
  config?: AiConfig;
  json?: boolean;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Tool names the model may call this turn. */
  tools?: string[];
}

export type { ToolCall, TurnResult } from "./turn";

export interface TurnHandlers {
  onText?: (delta: string) => void;
  onToolCall?: (call: ToolCall) => void;
}

function isAbort(err: unknown) {
  return err instanceof DOMException ? err.name === "AbortError" : (err as { name?: string })?.name === "AbortError";
}

function providerName(c?: AiConfig) {
  return (c ?? getAiConfig()).def.label.replace(/ \(.*\)$/, "");
}

export function friendlyMessage(code: AiErrorCode, fallback: string, c?: AiConfig) {
  const name = providerName(c);
  switch (code) {
    case "no_api_key":
      return `Add your ${name} API key in Settings to use the assistant.`;
    case "bad_key":
      return `${name} rejected the API key. Check it in Settings.`;
    case "rate_limited":
      return `Rate limited by ${name}. Wait a moment and try again.`;
    case "overloaded":
      return `${name} is overloaded right now. Try again shortly.`;
    case "model_not_found":
      return `This model is not available on ${name}. Pick another one in Settings.`;
    case "upstream_unreachable":
      return `Could not reach ${name}.`;
    case "network":
      return "Could not reach the server.";
    default:
      return fallback;
  }
}

async function errorFromResponse(res: Response, c: AiConfig) {
  let code: AiErrorCode = "server_error";
  let message = `Request failed (${res.status}).`;
  try {
    const data = (await res.json()) as { error?: unknown; message?: unknown };
    if (isAiErrorCode(data.error)) code = data.error;
    if (typeof data.message === "string" && data.message) message = data.message;
  } catch {
    // Non-JSON error body; keep the generic message.
  }
  // The provider's own words are more useful than ours for a bad request.
  const friendly = code === "bad_request" || code === "server_error" || code === "forbidden" ? message : friendlyMessage(code, message, c);
  return new AiError(code, friendly, res.status);
}

/** What to tell someone whose local model could not be reached from the browser. */
function unreachableHint(c: AiConfig) {
  let hint: string;
  if (c.provider === "ollama") {
    hint = `Could not reach Ollama at ${c.baseUrl}. Start it, and allow this site with OLLAMA_ORIGINS=${window.location.origin} (then restart Ollama).`;
  } else if (c.provider === "lmstudio") {
    hint = `Could not reach LM Studio at ${c.baseUrl}. Start its server and turn on "Enable CORS".`;
  } else {
    hint = `Could not reach ${c.baseUrl}. Check the address, and that the server allows requests from ${window.location.origin} (CORS).`;
  }
  // Chrome 142+ asks once before a website may reach this machine or the local network; a "Block" there looks like this.
  let target = "";
  try {
    target = new URL(c.baseUrl).hostname;
  } catch {
    /* an invalid URL is reported before any request */
  }
  return isPrivateHost(target) && !pageIsLocal() ? `${hint} If the browser asked whether this site may reach devices on your local network, allow it in this site's settings.` : hint;
}

function toAiError(err: unknown, c: AiConfig): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof ProviderError) {
    if (err.code === "upstream_unreachable" && (c.def.editableUrl || c.def.local)) return new AiError(err.code, unreachableHint(c));
    const keep = err.code === "bad_request" || err.code === "server_error" || err.code === "forbidden" || err.code === "aborted";
    return new AiError(err.code, keep ? err.message : friendlyMessage(err.code, err.message, c), err.status);
  }
  if (isAbort(err)) return new AiError("aborted", "Stopped.");
  return new AiError("network", "The connection dropped mid-response.");
}

function clampTokens(n?: number) {
  return Math.min(8192, Math.max(1, Math.floor(n ?? 4096)));
}

async function relayTurn(opts: StreamChatOptions, c: AiConfig, acc: TurnAccumulator) {
  const body: AiRequestBody = {
    provider: c.provider,
    model: c.model,
    ...(c.def.editableUrl ? { baseUrl: c.baseUrl } : {}),
    system: opts.system,
    messages: opts.messages,
    json: opts.json,
    maxTokens: opts.maxTokens,
    tools: opts.tools,
  };
  let res: Response;
  try {
    res = await fetch("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json", ...(c.apiKey ? { [API_KEY_HEADER]: c.apiKey } : {}) },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    if (isAbort(err)) throw new AiError("aborted", "Stopped.");
    throw new AiError("network", friendlyMessage("network", "", c));
  }
  if (!res.ok) throw await errorFromResponse(res, c);
  if (!res.body) throw new AiError("server_error", "Empty response from the server.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      acc.feed(decoder.decode(value, { stream: true }));
    }
    acc.feed(decoder.decode());
  } catch (err) {
    if (isAbort(err)) throw new AiError("aborted", "Stopped.");
    throw new AiError("network", "The connection dropped mid-response.");
  }
}

async function directTurn(opts: StreamChatOptions, c: AiConfig, acc: TurnAccumulator) {
  const baseUrl = normalizeBaseUrl(c.baseUrl);
  if (!baseUrl) throw new AiError("bad_request", "The endpoint URL is not a valid http(s) address.");
  if (c.def.keyRequired && !c.apiKey) throw new AiError("no_api_key", friendlyMessage("no_api_key", "", c));
  const call: ProviderCall = {
    family: c.def.family,
    provider: c.provider,
    baseUrl,
    apiKey: c.apiKey || undefined,
    model: c.model,
    system: opts.json ? `${opts.system}\n\n${JSON_ONLY_INSTRUCTION}` : opts.system,
    messages: opts.messages,
    tools: (opts.tools ?? []).map(toolByName).filter((t): t is NonNullable<typeof t> => Boolean(t)),
    maxTokens: clampTokens(opts.maxTokens),
    browser: true,
  };
  try {
    for await (const ev of streamProvider(call, opts.signal)) acc.apply(ev);
  } catch (err) {
    throw toAiError(err, c);
  }
  if (opts.json || acc.result.stopReason !== "max_tokens") return;
  acc.apply({ t: "text", d: "\n\n_Output stopped at the token limit._" });
}

/**
 * Run one turn and read the event stream. Resolves with the full turn;
 * throws AiError (code "aborted" when stopped).
 */
export async function streamTurn(opts: StreamChatOptions, handlers: TurnHandlers = {}): Promise<TurnResult> {
  const c = opts.config ?? getAiConfig();
  const acc = new TurnAccumulator(handlers);
  if (resolveTransport(c) === "direct") await directTurn(opts, c, acc);
  else await relayTurn(opts, c, acc);
  const result = acc.finish();
  const streamError = acc.error;
  if (streamError && !result.text && !result.toolCalls.length) throw new AiError("server_error", streamError);
  return result;
}

/** Text-only convenience: streams deltas and resolves with the full text. */
export async function streamChat(opts: StreamChatOptions, onDelta: (text: string) => void): Promise<string> {
  const r = await streamTurn(opts, { onText: onDelta });
  return r.text;
}

/** Which providers this deployment serves with the operator's own key. */
export async function fetchAiStatus(): Promise<{ serverKeys: ProviderId[] }> {
  const res = await fetch("/api/ai", { cache: "no-store" });
  if (!res.ok) throw new AiError("server_error", "Assistant status unavailable.", res.status);
  const data = (await res.json()) as { serverKey?: unknown; serverKeys?: unknown };
  const list = Array.isArray(data.serverKeys) ? data.serverKeys.filter(isProviderId) : data.serverKey === true ? (["anthropic"] as ProviderId[]) : [];
  return { serverKeys: list };
}

/**
 * The models an endpoint offers. Called from the browser: every provider in
 * the registry answers its list endpoint cross-origin, and local runners do
 * once CORS is allowed.
 */
export async function fetchModels(c: AiConfig, signal?: AbortSignal): Promise<string[]> {
  const baseUrl = normalizeBaseUrl(c.baseUrl);
  if (!baseUrl) throw new AiError("bad_request", "The endpoint URL is not a valid http(s) address.");
  try {
    const ids = await listProviderModels({ family: c.def.family, provider: c.provider, baseUrl, apiKey: c.apiKey || undefined, browser: true }, signal);
    return [...new Set(ids)].sort();
  } catch (err) {
    throw toAiError(err, c);
  }
}
