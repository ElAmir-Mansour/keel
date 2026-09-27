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

/** One turn on the wire: plain text only, a strict subset of the SDK's MessageParam. */
export interface AiChatMessage {
  role: AiChatRole;
  content: string;
}

export interface AiRequestBody {
  model: AiModelId;
  system: string;
  messages: AiChatMessage[];
  maxTokens?: number;
  /** Ask for JSON only. The route appends the instruction so a client cannot forget it. */
  json?: boolean;
}

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
