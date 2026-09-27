import { useSyncExternalStore } from "react";
import {
  API_KEY_HEADER,
  DEFAULT_MODEL,
  STORAGE_KEYS,
  isAiErrorCode,
  isAiModel,
  type AiChatMessage,
  type AiErrorCode,
  type AiModelId,
  type AiRequestBody,
} from "./models";
import { TurnAccumulator, type ToolCall, type TurnResult } from "./turn";

// Browser side of the assistant: the key and model live in localStorage (never
// in IndexedDB, so they stay out of the JSON export), and every call goes
// through streamChat so the panel and the settings page share one error model.

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
  for (const l of listeners) l();
}

export function getApiKey() {
  return read(STORAGE_KEYS.apiKey) ?? "";
}

export function setApiKey(key: string) {
  write(STORAGE_KEYS.apiKey, key.trim() || null);
}

export function getModel(): AiModelId {
  const v = read(STORAGE_KEYS.model);
  return isAiModel(v) ? v : DEFAULT_MODEL;
}

export function setModel(model: AiModelId) {
  write(STORAGE_KEYS.model, model);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (!e.key || e.key.startsWith("keel.ai.")) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Live view of the chosen model; the server snapshot is the default so hydration matches. */
export function useAiModel() {
  return useSyncExternalStore(subscribe, getModel, () => DEFAULT_MODEL);
}

export function useAiApiKey() {
  return useSyncExternalStore(subscribe, getApiKey, () => "");
}

// ----- transport ---------------------------------------------------------------

export interface StreamChatOptions {
  system: string;
  messages: AiChatMessage[];
  model?: AiModelId;
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

export function friendlyMessage(code: AiErrorCode, fallback: string) {
  switch (code) {
    case "no_api_key":
      return "Add your Anthropic API key in Settings to use the assistant.";
    case "bad_key":
      return "Anthropic rejected the API key. Check it in Settings.";
    case "rate_limited":
      return "Rate limited by Anthropic. Wait a moment and try again.";
    case "overloaded":
      return "Anthropic is overloaded right now. Try again shortly.";
    case "model_not_found":
      return "This model is not available on your API key. Pick another one in Settings.";
    case "upstream_unreachable":
      return "The server could not reach Anthropic.";
    case "network":
      return "Could not reach the server.";
    default:
      return fallback;
  }
}

async function errorFromResponse(res: Response) {
  let code: AiErrorCode = "server_error";
  let message = `Request failed (${res.status}).`;
  try {
    const data = (await res.json()) as { error?: unknown; message?: unknown };
    if (isAiErrorCode(data.error)) code = data.error;
    if (typeof data.message === "string" && data.message) message = data.message;
  } catch {
    // Non-JSON error body; keep the generic message.
  }
  return new AiError(code, friendlyMessage(code, message), res.status);
}

/**
 * POST one turn and read the event stream. Resolves with the full turn;
 * throws AiError (code "aborted" when stopped).
 */
export async function streamTurn(opts: StreamChatOptions, handlers: TurnHandlers = {}): Promise<TurnResult> {
  const key = getApiKey();
  const body: AiRequestBody = {
    model: opts.model ?? getModel(),
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
      headers: { "content-type": "application/json", ...(key ? { [API_KEY_HEADER]: key } : {}) },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    if (isAbort(err)) throw new AiError("aborted", "Stopped.");
    throw new AiError("network", friendlyMessage("network", ""));
  }
  if (!res.ok) throw await errorFromResponse(res);
  if (!res.body) throw new AiError("server_error", "Empty response from the server.");

  const acc = new TurnAccumulator(handlers);
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

/** Whether this deployment lets the operator's server-side key serve requests without a personal key. */
export async function fetchAiStatus(): Promise<{ serverKey: boolean }> {
  const res = await fetch("/api/ai", { cache: "no-store" });
  if (!res.ok) throw new AiError("server_error", "Assistant status unavailable.", res.status);
  const data = (await res.json()) as { serverKey?: unknown };
  return { serverKey: data.serverKey === true };
}
