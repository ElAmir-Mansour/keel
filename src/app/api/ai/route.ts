import { ProviderError, streamProvider, type ProviderCall } from "@/lib/ai/adapters";
import { API_KEY_HEADER, type AiChatMessage, type AiContentBlock, type AiErrorCode, type AiStreamEvent } from "@/lib/ai/models";
import { JSON_ONLY_INSTRUCTION } from "@/lib/ai/prompts";
import { PROVIDERS, isPrivateHost, normalizeBaseUrl, providerById, type ProviderDef, type ProviderId } from "@/lib/ai/providers";
import { AI_TOOL_NAMES, toolByName } from "@/lib/ai/tools";
import { isLocalRequest } from "@/lib/local-bridge";

// The only server code that talks to a model. It relays one chat turn to the
// provider the person chose and streams Keel's events back as newline-delimited
// JSON: text deltas, tool calls (executed in the browser only after approval),
// thinking blocks and provider state a tool turn must echo, and the stop
// reason. The key arrives
// per request in a header and is used for exactly that request; it is never
// stored or logged.
//
// It never fetches an address the browser picked, with one exception: when
// Keel itself runs on this machine (the request's Host is localhost), it may
// relay to a local or custom endpoint such as Ollama, so offline models work
// without any CORS set-up. On a public deployment those providers are called
// straight from the browser instead.

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_MAX_TOKENS = 4096;
const MAX_TOKENS_CAP = 8192;
const MAX_TOTAL_CHARS = 400_000;
const MODEL_RE = /^[\w.:/@+-]{1,200}$/;

function jsonError(code: AiErrorCode, status: number, message?: string) {
  return Response.json({ error: code, ...(message ? { message } : {}) }, { status });
}

const SERVER_KEY_ENV: Partial<Record<ProviderId, string[]>> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  groq: ["GROQ_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  xai: ["XAI_API_KEY"],
};

/** The operator's key for a provider, only when they opted in explicitly. */
function serverKey(provider: ProviderId) {
  if (process.env.KEEL_ALLOW_SERVER_KEY !== "true") return undefined;
  for (const name of SERVER_KEY_ENV[provider] ?? []) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return undefined;
}

interface ParsedBody {
  provider: ProviderDef;
  model: string;
  baseUrl?: string;
  system: string;
  messages: AiChatMessage[];
  maxTokens: number;
  json: boolean;
  tools: string[];
}

function isBlock(b: unknown): b is AiContentBlock {
  if (!b || typeof b !== "object") return false;
  const x = b as Record<string, unknown>;
  switch (x.type) {
    case "text":
      return typeof x.text === "string";
    case "tool_use":
      return typeof x.id === "string" && typeof x.name === "string" && typeof x.input === "object" && x.input !== null && (x.signature === undefined || typeof x.signature === "string");
    case "tool_result":
      return typeof x.tool_use_id === "string" && typeof x.content === "string";
    case "thinking":
      return typeof x.thinking === "string" && typeof x.signature === "string";
    case "redacted_thinking":
      return typeof x.data === "string";
    case "provider_state":
      // Opaque to Keel; the adapter for that provider picks out the fields it replays and ignores the rest.
      return typeof x.provider === "string" && x.provider.length <= 64 && typeof x.data === "object" && x.data !== null;
    default:
      return false;
  }
}

function blockChars(b: AiContentBlock) {
  switch (b.type) {
    case "text":
      return b.text.length;
    case "tool_use":
      return JSON.stringify(b.input).length;
    case "tool_result":
      return b.content.length;
    case "provider_state":
      // Encrypted reasoning is sent upstream too, so it counts toward the size cap.
      return JSON.stringify(b.data).length;
    default:
      return 0;
  }
}

function parseBody(raw: unknown): ParsedBody | string {
  if (!raw || typeof raw !== "object") return "Body must be a JSON object.";
  const b = raw as Record<string, unknown>;
  // Requests from before providers existed carry only a Claude model.
  const provider = providerById(typeof b.provider === "string" ? b.provider : "anthropic");
  if (!provider) return `provider must be one of ${PROVIDERS.map((p) => p.id).join(", ")}.`;
  if (typeof b.model !== "string" || !MODEL_RE.test(b.model)) return "model must be a model id.";
  if (b.baseUrl !== undefined && typeof b.baseUrl !== "string") return "baseUrl must be a string.";
  if (typeof b.system !== "string") return "system must be a string.";
  if (!Array.isArray(b.messages) || !b.messages.length) return "messages must be a non-empty array.";
  const messages: AiChatMessage[] = [];
  let total = b.system.length;
  for (const m of b.messages) {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if (role !== "user" && role !== "assistant") return "each message needs a role of user or assistant.";
    if (typeof content === "string") {
      if (!content.trim()) return "message content must not be empty.";
      total += content.length;
      messages.push({ role, content });
    } else if (Array.isArray(content) && content.length && content.every(isBlock)) {
      total += content.reduce((n, x) => n + blockChars(x), 0);
      messages.push({ role, content });
    } else {
      return "message content must be a string or an array of content blocks.";
    }
  }
  if (messages[0].role !== "user") return "the first message must be from the user.";
  if (total > MAX_TOTAL_CHARS) return "request is too large.";
  let maxTokens = DEFAULT_MAX_TOKENS;
  if (b.maxTokens !== undefined) {
    if (typeof b.maxTokens !== "number" || !Number.isFinite(b.maxTokens) || b.maxTokens < 1) return "maxTokens must be a positive number.";
    maxTokens = Math.min(MAX_TOKENS_CAP, Math.floor(b.maxTokens));
  }
  let tools: string[] = [];
  if (b.tools !== undefined) {
    if (!Array.isArray(b.tools) || !b.tools.every((t) => typeof t === "string" && AI_TOOL_NAMES.includes(t))) return "tools must be names from the registry.";
    tools = [...new Set(b.tools as string[])];
  }
  return { provider, model: b.model, baseUrl: b.baseUrl as string | undefined, system: b.system, messages, maxTokens, json: b.json === true, tools };
}

/** Where to send the call, or why the relay will not. */
function resolveBaseUrl(p: ParsedBody, req: Request): string | Response {
  if (!p.provider.editableUrl) return p.provider.baseUrl;
  if (!isLocalRequest(req)) {
    return jsonError("bad_request", 400, `${p.provider.label} is called directly from your browser on this site; the relay only reaches it when Keel runs on your own machine.`);
  }
  const url = normalizeBaseUrl(p.baseUrl || p.provider.baseUrl);
  if (!url) return jsonError("bad_request", 400, "The endpoint URL is not a valid http(s) address.");
  return url;
}

function errorResponse(err: unknown): Response {
  if (err instanceof ProviderError) {
    const status = err.code === "no_api_key" || err.code === "bad_key" ? 401 : err.status && err.status >= 400 && err.status <= 599 ? err.status : 502;
    return jsonError(err.code, status, err.message);
  }
  console.error("[api/ai]", err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : "unknown error");
  return jsonError("server_error", 500, "Unexpected server error.");
}

/** Text appended after the stream so a cut-off answer does not read as complete. */
function trailer(stopReason: string | null, emitted: boolean, json: boolean) {
  if (json) return "";
  if (stopReason === "max_tokens") return "\n\n_Output stopped at the token limit._";
  if (stopReason === "refusal" && !emitted) return "The model declined this request.";
  return "";
}

export function GET() {
  const serverKeys = PROVIDERS.filter((p) => serverKey(p.id)).map((p) => p.id);
  return Response.json(
    // `serverKey` stays for older clients: true when Anthropic has an operator key.
    { serverKey: serverKeys.includes("anthropic"), serverKeys, providers: PROVIDERS.map((p) => p.id), tools: AI_TOOL_NAMES },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError("bad_request", 400, "Body must be JSON.");
  }
  const parsed = parseBody(raw);
  if (typeof parsed === "string") return jsonError("bad_request", 400, parsed);
  const baseUrl = resolveBaseUrl(parsed, req);
  if (typeof baseUrl !== "string") return baseUrl;
  // Belt and braces: a fixed provider URL is never private, and an editable
  // one is only allowed for a local request, where private is the point.
  if (!parsed.provider.editableUrl && isPrivateHost(new URL(baseUrl).hostname)) return jsonError("bad_request", 400, "Refusing a private address.");

  const apiKey = req.headers.get(API_KEY_HEADER)?.trim() || serverKey(parsed.provider.id);
  if (parsed.provider.keyRequired && !apiKey) return jsonError("no_api_key", 401);

  const call: ProviderCall = {
    family: parsed.provider.family,
    provider: parsed.provider.id,
    baseUrl,
    apiKey,
    model: parsed.model,
    system: parsed.json ? `${parsed.system}\n\n${JSON_ONLY_INSTRUCTION}` : parsed.system,
    messages: parsed.messages,
    tools: parsed.tools.map(toolByName).filter((t): t is NonNullable<typeof t> => Boolean(t)),
    maxTokens: parsed.maxTokens,
  };

  const events = streamProvider(call, req.signal);
  // Pull the first event before committing to a 200, so a bad key or a rate
  // limit still reaches the client as a real status code.
  let first: IteratorResult<AiStreamEvent>;
  try {
    first = await events.next();
  } catch (err) {
    return errorResponse(err);
  }

  const encoder = new TextEncoder();
  let stopReason: string | null = null;
  let emitted = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: AiStreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`));
      const handle = (ev: AiStreamEvent) => {
        if (ev.t === "stop") {
          stopReason = ev.reason;
          return;
        }
        if (ev.t === "text") emitted = true;
        send(ev);
      };
      try {
        if (!first.done) handle(first.value);
        for (let r = await events.next(); !r.done; r = await events.next()) handle(r.value);
        const tail = trailer(stopReason, emitted, parsed.json);
        if (tail) send({ t: "text", d: tail });
        send({ t: "stop", reason: stopReason });
        controller.close();
      } catch (err) {
        if (req.signal.aborted || (err instanceof ProviderError && err.code === "aborted")) {
          controller.close();
          return;
        }
        console.error("[api/ai] stream failed:", err instanceof Error ? err.name : "unknown error");
        try {
          send({ t: "error", message: `The connection to ${parsed.provider.label} dropped.` });
          controller.close();
        } catch {
          controller.error(err);
        }
      }
    },
    cancel() {
      void events.return?.(undefined);
    },
  });

  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
