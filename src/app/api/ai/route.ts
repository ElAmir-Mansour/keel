import Anthropic from "@anthropic-ai/sdk";
import {
  AI_MODELS,
  API_KEY_HEADER,
  isAiModel,
  type AiChatMessage,
  type AiErrorCode,
  type AiModelId,
} from "@/lib/ai/models";
import { JSON_ONLY_INSTRUCTION } from "@/lib/ai/prompts";

// The only server code in Keel. It relays one chat turn to Anthropic and
// streams the text back. The user's key arrives per request in a header and
// is used for exactly that request; it is never stored or logged.

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_MAX_TOKENS = 4096;
const MAX_TOKENS_CAP = 8192;
const MAX_TOTAL_CHARS = 400_000;

function jsonError(code: AiErrorCode, status: number, message?: string) {
  return Response.json({ error: code, ...(message ? { message } : {}) }, { status });
}

/** The operator's key, only when they opted in explicitly. */
function serverKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  return process.env.KEEL_ALLOW_SERVER_KEY === "true" && key ? key : undefined;
}

/** Trim an SDK error message for the client: one line, no payload dump. */
function short(message: string) {
  const firstLine = message.replace(/\s+/g, " ").trim();
  return firstLine.length > 200 ? `${firstLine.slice(0, 199)}…` : firstLine;
}

interface ParsedBody {
  model: AiModelId;
  system: string;
  messages: AiChatMessage[];
  maxTokens: number;
  json: boolean;
}

function parseBody(raw: unknown): ParsedBody | string {
  if (!raw || typeof raw !== "object") return "Body must be a JSON object.";
  const b = raw as Record<string, unknown>;
  if (!isAiModel(b.model)) return `model must be one of ${AI_MODELS.map((m) => m.id).join(", ")}.`;
  if (typeof b.system !== "string") return "system must be a string.";
  if (!Array.isArray(b.messages) || !b.messages.length) return "messages must be a non-empty array.";
  const messages: AiChatMessage[] = [];
  for (const m of b.messages) {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string" || !content.trim()) {
      return "each message needs a role of user or assistant and non-empty string content.";
    }
    messages.push({ role, content });
  }
  if (messages[0].role !== "user") return "the first message must be from the user.";
  const total = b.system.length + messages.reduce((n, m) => n + m.content.length, 0);
  if (total > MAX_TOTAL_CHARS) return "request is too large.";
  let maxTokens = DEFAULT_MAX_TOKENS;
  if (b.maxTokens !== undefined) {
    if (typeof b.maxTokens !== "number" || !Number.isFinite(b.maxTokens) || b.maxTokens < 1) {
      return "maxTokens must be a positive number.";
    }
    maxTokens = Math.min(MAX_TOKENS_CAP, Math.floor(b.maxTokens));
  }
  return { model: b.model, system: b.system, messages, maxTokens, json: b.json === true };
}

function errorResponse(err: unknown): Response {
  // Most specific first; APIConnectionError and APIUserAbortError are APIError
  // subclasses in this SDK, so they must be checked before the base class.
  if (err instanceof Anthropic.AuthenticationError) return jsonError("bad_key", 401);
  if (err instanceof Anthropic.PermissionDeniedError) return jsonError("forbidden", 403, short(err.message));
  if (err instanceof Anthropic.NotFoundError) return jsonError("model_not_found", 404, short(err.message));
  if (err instanceof Anthropic.RateLimitError) return jsonError("rate_limited", 429, short(err.message));
  if (err instanceof Anthropic.BadRequestError) return jsonError("bad_request", 400, short(err.message));
  if (err instanceof Anthropic.APIUserAbortError) return jsonError("aborted", 400, "Request aborted.");
  if (err instanceof Anthropic.APIConnectionError) return jsonError("upstream_unreachable", 502, "Could not reach Anthropic.");
  if (err instanceof Anthropic.APIError) {
    if (err.status === 529) return jsonError("overloaded", 503, "Anthropic is overloaded.");
    const status = typeof err.status === "number" && err.status >= 400 && err.status <= 599 ? err.status : 500;
    return jsonError("server_error", status, short(err.message));
  }
  console.error("[api/ai]", err instanceof Error ? `${err.name}: ${short(err.message)}` : "unknown error");
  return jsonError("server_error", 500, "Unexpected server error.");
}

/** Text appended after the stream so a cut-off answer does not read as complete. */
function trailer(stopReason: Anthropic.StopReason | null, emitted: boolean, json: boolean) {
  if (json) return "";
  if (stopReason === "max_tokens") return "\n\n_Output stopped at the token limit._";
  if (stopReason === "refusal" && !emitted) return "The model declined this request.";
  return "";
}

export function GET() {
  return Response.json(
    { serverKey: Boolean(serverKey()), models: AI_MODELS.map((m) => m.id) },
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

  const apiKey = req.headers.get(API_KEY_HEADER)?.trim() || serverKey();
  if (!apiKey) return jsonError("no_api_key", 401);

  const client = new Anthropic({ apiKey, maxRetries: 1 });
  const system = parsed.json ? `${parsed.system}\n\n${JSON_ONLY_INSTRUCTION}` : parsed.system;
  const params: Anthropic.MessageStreamParams = {
    model: parsed.model,
    max_tokens: parsed.maxTokens,
    system,
    messages: parsed.messages,
    // Haiku 4.5 predates adaptive thinking and rejects it with a 400.
    ...(parsed.model === "claude-haiku-4-5" ? {} : { thinking: { type: "adaptive" as const } }),
  };

  const stream = client.messages.stream(params, { signal: req.signal });
  const events = stream[Symbol.asyncIterator]();

  // Pull the first event before committing to a 200, so a bad key or a rate
  // limit still reaches the client as a real status code instead of a broken
  // text stream.
  let first: IteratorResult<Anthropic.MessageStreamEvent>;
  try {
    first = await events.next();
  } catch (err) {
    return errorResponse(err);
  }

  const encoder = new TextEncoder();
  let stopReason: Anthropic.StopReason | null = null;
  let emitted = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const handle = (ev: Anthropic.MessageStreamEvent) => {
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          emitted = true;
          controller.enqueue(encoder.encode(ev.delta.text));
        } else if (ev.type === "message_delta" && ev.delta.stop_reason) {
          stopReason = ev.delta.stop_reason;
        }
      };
      try {
        if (!first.done) handle(first.value);
        for (let r = await events.next(); !r.done; r = await events.next()) handle(r.value);
        const tail = trailer(stopReason, emitted, parsed.json);
        if (tail) controller.enqueue(encoder.encode(tail));
        controller.close();
      } catch (err) {
        if (err instanceof Anthropic.APIUserAbortError || req.signal.aborted) {
          controller.close();
          return;
        }
        console.error("[api/ai] stream failed:", err instanceof Error ? err.name : "unknown error");
        controller.error(err);
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
