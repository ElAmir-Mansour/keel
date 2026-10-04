// Shared by the browser and the route handler, so nothing in here may touch
// window, localStorage or process.env.

import type { ProviderId } from "./providers";

/** Header the browser uses to send the user's own key. The route never logs it. */
export const API_KEY_HEADER = "x-keel-api-key";

/** localStorage keys. The legacy key and model are read once and migrated to Anthropic's slots. */
export const STORAGE_KEYS = {
  provider: "keel.ai.provider",
  transport: "keel.ai.transport",
  key: (provider: string) => `keel.ai.key.${provider}`,
  model: (provider: string) => `keel.ai.model.${provider}`,
  baseUrl: (provider: string) => `keel.ai.url.${provider}`,
  legacyKey: "keel.ai.apiKey",
  legacyModel: "keel.ai.model",
} as const;

export type AiChatRole = "user" | "assistant";

// Content blocks on the wire: the subset of the Messages API the app uses.
// Thinking blocks are echoed back untouched so a tool-use turn can continue.
export type AiContentBlock =
  | { type: "text"; text: string }
  // `signature` carries Gemini's thought signature, which must be echoed with the call.
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown>; signature?: string }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string }
  // Opaque state one provider needs echoed on the next request (OpenAI's
  // encrypted reasoning items, for one). Kept in order with the other blocks;
  // every other provider's converter drops it.
  | { type: "provider_state"; provider: string; data: unknown };

/** One turn on the wire: plain text, or content blocks for tool use. */
export interface AiChatMessage {
  role: AiChatRole;
  content: string | AiContentBlock[];
}

export interface AiRequestBody {
  provider: ProviderId;
  model: string;
  /** Only for local and custom providers, and only honoured by a relay running on this machine. */
  baseUrl?: string;
  system: string;
  messages: AiChatMessage[];
  maxTokens?: number;
  /** Ask for JSON only. The route appends the instruction so a client cannot forget it. */
  json?: boolean;
  /** Names of tools from the shared registry the model may call this turn. */
  tools?: string[];
}

/** Events the route streams back as newline-delimited JSON. */
export type AiStreamEvent =
  | { t: "text"; d: string }
  | { t: "tool_use"; id: string; name: string; input: Record<string, unknown>; signature?: string }
  | { t: "thinking"; thinking: string; signature: string }
  | { t: "redacted_thinking"; data: string }
  | { t: "provider_state"; provider: string; data: unknown }
  | { t: "stop"; reason: string | null }
  | { t: "error"; message: string };

export const AI_ERROR_CODES = [
  "no_api_key",
  "bad_key",
  "forbidden",
  "model_not_found",
  "bad_request",
  "rate_limited",
  "overloaded",
  "upstream_unreachable",
  "server_error",
  "network",
  "aborted",
] as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export function isAiErrorCode(value: unknown): value is AiErrorCode {
  return typeof value === "string" && (AI_ERROR_CODES as readonly string[]).includes(value);
}
