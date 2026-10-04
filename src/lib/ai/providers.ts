// Every AI provider Keel can talk to. Shared by the browser and the route
// handler, so nothing here may touch window, localStorage or process.env.
//
// Four wire families cover them all: Anthropic's Messages API, OpenAI's
// Responses API (which OpenAI's current models need for tool calling), Chat
// Completions (which every other OpenAI-compatible provider and both local
// runners speak), and Gemini's generateContent. A provider is a family plus a
// base URL, an auth style and a few suggested models; the model field always
// accepts any id.

export type ProviderFamily = "anthropic" | "openai-responses" | "openai" | "gemini";

export type ProviderId =
  | "anthropic"
  | "openai"
  | "gemini"
  | "openrouter"
  | "groq"
  | "mistral"
  | "deepseek"
  | "xai"
  | "ollama"
  | "lmstudio"
  | "custom";

export interface ProviderModel {
  id: string;
  label: string;
  hint?: string;
}

export interface ProviderDef {
  id: ProviderId;
  label: string;
  family: ProviderFamily;
  /** Default base URL; for local and custom providers the person can change it. */
  baseUrl: string;
  /** Whether the base URL is editable in Settings. */
  editableUrl: boolean;
  /** Runs on this machine or network: no key, works offline. */
  local: boolean;
  keyRequired: boolean;
  keyPlaceholder?: string;
  keyUrl?: string;
  /** Suggested models; any id the provider accepts can be typed instead. */
  models: ProviderModel[];
  /** Short line shown under the picker. */
  blurb: string;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    family: "anthropic",
    baseUrl: "https://api.anthropic.com",
    editableUrl: false,
    local: false,
    keyRequired: true,
    keyPlaceholder: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/settings/keys",
    models: [
      { id: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "strong" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "fast" },
      { id: "claude-fable-5-1", label: "Claude Fable 5.1", hint: "most capable" },
    ],
    blurb: "Claude models with tool use and extended thinking.",
  },
  {
    id: "openai",
    label: "OpenAI",
    family: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    editableUrl: false,
    local: false,
    keyRequired: true,
    keyPlaceholder: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
    models: [
      { id: "gpt-6-astra", label: "GPT-6 Astra", hint: "best" },
      { id: "gpt-6-luna", label: "GPT-6 Luna", hint: "fast" },
    ],
    blurb: "GPT models through the Responses API, which they need for tool use.",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    family: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    editableUrl: false,
    local: false,
    keyRequired: true,
    keyPlaceholder: "AIza…",
    keyUrl: "https://aistudio.google.com/apikey",
    models: [
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", hint: "best" },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", hint: "preview" },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", hint: "cheapest" },
    ],
    blurb: "Gemini models through the Gemini API (AI Studio key).",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    family: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    editableUrl: false,
    local: false,
    keyRequired: true,
    keyPlaceholder: "sk-or-…",
    keyUrl: "https://openrouter.ai/keys",
    models: [
      // Load models lists the rest; only the router is pinned here.
      { id: "openrouter/auto", label: "Auto router", hint: "picks a model per request" },
    ],
    blurb: "One key for hundreds of models from many labs.",
  },
  {
    id: "groq",
    label: "Groq",
    family: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    editableUrl: false,
    local: false,
    keyRequired: true,
    keyPlaceholder: "gsk_…",
    keyUrl: "https://console.groq.com/keys",
    models: [
      { id: "openai/gpt-oss-120b", label: "gpt-oss 120B", hint: "best" },
      { id: "openai/gpt-oss-20b", label: "gpt-oss 20B", hint: "fast" },
    ],
    blurb: "Open models served very fast.",
  },
  {
    id: "mistral",
    label: "Mistral",
    family: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    editableUrl: false,
    local: false,
    keyRequired: true,
    keyUrl: "https://console.mistral.ai/api-keys",
    models: [
      { id: "mistral-large-latest", label: "Mistral Large", hint: "best" },
      { id: "mistral-small-latest", label: "Mistral Small", hint: "fast" },
    ],
    blurb: "Mistral's hosted models.",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    family: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    editableUrl: false,
    local: false,
    keyRequired: true,
    keyPlaceholder: "sk-…",
    keyUrl: "https://platform.deepseek.com/api_keys",
    models: [
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", hint: "best" },
      { id: "deepseek-flash", label: "DeepSeek Flash", hint: "fast" },
    ],
    blurb: "DeepSeek's hosted models.",
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    family: "openai",
    baseUrl: "https://api.x.ai/v1",
    editableUrl: false,
    local: false,
    keyRequired: true,
    keyPlaceholder: "xai-…",
    keyUrl: "https://console.x.ai",
    models: [
      { id: "grok-4.7", label: "Grok 4.7", hint: "best" },
      { id: "grok-4.3", label: "Grok 4.3" },
    ],
    blurb: "Grok models.",
  },
  {
    id: "ollama",
    label: "Ollama (on this computer)",
    family: "openai",
    baseUrl: "http://localhost:11434/v1",
    editableUrl: true,
    local: true,
    keyRequired: false,
    models: [
      // The default is the small one: a first pull should be minutes, not an hour.
      { id: "llama3.1", label: "Llama 3.1 8B", hint: "about 5 GB" },
      { id: "gemma4:12b", label: "Gemma 4 12B", hint: "better" },
      { id: "qwen3.6:35b-a3b", label: "Qwen 3.6 35B-A3B", hint: "best, needs 32 GB RAM" },
    ],
    blurb: "Free, private and offline. Runs models on your own machine.",
  },
  {
    id: "lmstudio",
    label: "LM Studio (on this computer)",
    family: "openai",
    baseUrl: "http://localhost:1234/v1",
    editableUrl: true,
    local: true,
    keyRequired: false,
    models: [],
    blurb: "Free, private and offline. Uses whatever model LM Studio has loaded.",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    family: "openai",
    baseUrl: "",
    editableUrl: true,
    local: false,
    keyRequired: false,
    keyPlaceholder: "optional",
    models: [],
    blurb: "Any server that speaks the OpenAI Chat Completions API: vLLM, LocalAI, Together, Fireworks, a company gateway.",
  },
];

export const DEFAULT_PROVIDER: ProviderId = "anthropic";

export function providerById(id: string | null | undefined): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function isProviderId(v: unknown): v is ProviderId {
  return typeof v === "string" && PROVIDERS.some((p) => p.id === v);
}

export function defaultModelFor(p: ProviderDef) {
  return p.models[0]?.id ?? "";
}

export function modelLabelFor(p: ProviderDef | undefined, model: string) {
  return p?.models.find((m) => m.id === model)?.label ?? model;
}

/**
 * Where a host lives, in the terms of the browser's Local Network Access
 * checks: this machine, the local network, or the internet. Only literal
 * addresses and reserved names are classified; anything else is public.
 */
export type AddressSpace = "loopback" | "local" | "public";

export function addressSpace(hostname: string): AddressSpace {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h === "::1" || h === "0.0.0.0" || h === "::") return "loopback";
  if (h.endsWith(".local")) return "local";
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127) return "loopback";
    return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) ? "local" : "public";
  }
  // IPv6 only: a hostname such as fdroid.org is not a unique-local address.
  if (!h.includes(":")) return "public";
  // IPv4-mapped, dotted or as URL parsing prints it (::ffff:7f00:1).
  const dotted = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return addressSpace(dotted[1]);
  const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const [hi, lo] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
    return addressSpace(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  // fc00::/7 (unique local) and fe80::/10 (link local); the first group is always four digits.
  return /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h) ? "local" : "public";
}

/** Hosts that only exist on this machine or its network. */
export function isPrivateHost(hostname: string) {
  return addressSpace(hostname) !== "public";
}

/** A base URL with no trailing slash, or null when it is not http(s). */
export function normalizeBaseUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}
