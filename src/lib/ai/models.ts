// Shared by the browser and the route handler, so nothing in here may touch
// window, localStorage or process.env.

export const AI_MODELS = [
  { id: "claude-opus-5", label: "Claude Opus 5", hint: "best", cost: "$5 in / $25 out per million tokens" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", hint: "fast", cost: "$2 in / $10 out per million tokens" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "cheapest", cost: "$1 in / $5 out per million tokens" },
] as const;

export type AiModelId = (typeof AI_MODELS)[number]["id"];
export const DEFAULT_MODEL: AiModelId = "claude-opus-5";

export function isAiModel(value: unknown): value is AiModelId {
  return typeof value === "string" && AI_MODELS.some((m) => m.id === value);
}

export function modelLabel(id: string) {
  return AI_MODELS.find((m) => m.id === id)?.label ?? id;
}

/** Header the browser uses to send the user's own key. The route never logs it. */
export const API_KEY_HEADER = "x-keel-api-key";

export const STORAGE_KEYS = { apiKey: "keel.ai.apiKey", model: "keel.ai.model" } as const;

export type AiChatRole = "user" | "assistant";

// Content blocks on the wire: the subset of the Messages API the app uses.
// Thinking blocks are echoed back untouched so a tool-use turn can continue.
export type AiContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string };

/** One turn on the wire: plain text, or content blocks for tool use. */
export interface AiChatMessage {
  role: AiChatRole;
  content: string | AiContentBlock[];
}

export interface AiRequestBody {
  model: AiModelId;
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
  | { t: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { t: "thinking"; thinking: string; signature: string }
  | { t: "redacted_thinking"; data: string }
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
