import Anthropic from "@anthropic-ai/sdk";
import {
  AI_MODELS,
  API_KEY_HEADER,
  isAiModel,
  type AiChatMessage,
  type AiContentBlock,
  type AiErrorCode,
  type AiModelId,
  type AiStreamEvent,
} from "@/lib/ai/models";
import { JSON_ONLY_INSTRUCTION } from "@/lib/ai/prompts";
import { AI_TOOL_NAMES, toolByName } from "@/lib/ai/tools";

// The only server code in Keel. It relays one chat turn to Anthropic and
// streams events back as newline-delimited JSON: text deltas, tool calls the
// model proposes (executed in the browser only after approval), the thinking
// blocks a tool turn must echo, and the stop reason. The user's key arrives
// per request in a header and is used for exactly that request; it is never
// stored or logged.

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
  tools: string[];
}

function isBlock(b: unknown): b is AiContentBlock {
  if (!b || typeof b !== "object") return false;
  const x = b as Record<string, unknown>;
  switch (x.type) {
    case "text":
      return typeof x.text === "string";
    case "tool_use":
      return typeof x.id === "string" && typeof x.name === "string" && typeof x.input === "object" && x.input !== null;
    case "tool_result":
      return typeof x.tool_use_id === "string" && typeof x.content === "string";
    case "thinking":
      return typeof x.thinking === "string" && typeof x.signature === "string";
    case "redacted_thinking":
      return typeof x.data === "string";
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
    default:
      return 0;
  }
}

function parseBody(raw: unknown): ParsedBody | string {
  if (!raw || typeof raw !== "object") return "Body must be a JSON object.";
  const b = raw as Record<string, unknown>;
  if (!isAiModel(b.model)) return `model must be one of ${AI_MODELS.map((m) => m.id).join(", ")}.`;
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
  return { model: b.model, system: b.system, messages, maxTokens, json: b.json === true, tools };
}

function errorResponse(err: unknown): Response {
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
function trailer(stopReason: string | null, emitted: boolean, json: boolean) {
  if (json) return "";
  if (stopReason === "max_tokens") return "\n\n_Output stopped at the token limit._";
  if (stopReason === "refusal" && !emitted) return "The model declined this request.";
  return "";
}

/** Our wire blocks → SDK params. Thinking blocks pass through untouched. */
function toSdkContent(content: string | AiContentBlock[]): string | Anthropic.ContentBlockParam[] {
  if (typeof content === "string") return content;
  return content.map((b): Anthropic.ContentBlockParam => {
    switch (b.type) {
      case "text":
        return { type: "text", text: b.text };
      case "tool_use":
        return { type: "tool_use", id: b.id, name: b.name, input: b.input };
      case "tool_result":
        return { type: "tool_result", tool_use_id: b.tool_use_id, content: b.content, ...(b.is_error ? { is_error: true } : {}) };
      case "thinking":
        return { type: "thinking", thinking: b.thinking, signature: b.signature };
      case "redacted_thinking":
        return { type: "redacted_thinking", data: b.data };
    }
  });
}

export function GET() {
  return Response.json({ serverKey: Boolean(serverKey()), models: AI_MODELS.map((m) => m.id), tools: AI_TOOL_NAMES }, { headers: { "cache-control": "no-store" } });
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
  const tools: Anthropic.Tool[] = parsed.tools
    .map(toolByName)
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
    .map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema, strict: true }));
  const params: Anthropic.MessageStreamParams = {
    model: parsed.model,
    max_tokens: parsed.maxTokens,
    system,
    messages: parsed.messages.map((m) => ({ role: m.role, content: toSdkContent(m.content) })),
    ...(tools.length ? { tools } : {}),
    // Haiku 4.5 predates adaptive thinking and rejects it with a 400.
    ...(parsed.model === "claude-haiku-4-5" ? {} : { thinking: { type: "adaptive" as const } }),
  };

  const stream = client.messages.stream(params, { signal: req.signal });
  const events = stream[Symbol.asyncIterator]();

  // Pull the first event before committing to a 200, so a bad key or a rate
  // limit still reaches the client as a real status code.
  let first: IteratorResult<Anthropic.MessageStreamEvent>;
  try {
    first = await events.next();
  } catch (err) {
    return errorResponse(err);
  }

  const encoder = new TextEncoder();
  let stopReason: string | null = null;
  let emitted = false;
  // Per-index accumulators for blocks that arrive in pieces.
  const open = new Map<number, { kind: "tool_use"; id: string; name: string; json: string } | { kind: "thinking"; thinking: string; signature: string }>();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: AiStreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`));
      const handle = (ev: Anthropic.MessageStreamEvent) => {
        if (ev.type === "content_block_start") {
          const cb = ev.content_block;
          if (cb.type === "tool_use") open.set(ev.index, { kind: "tool_use", id: cb.id, name: cb.name, json: "" });
          else if (cb.type === "thinking") open.set(ev.index, { kind: "thinking", thinking: cb.thinking ?? "", signature: "" });
          else if (cb.type === "redacted_thinking") send({ t: "redacted_thinking", data: cb.data });
        } else if (ev.type === "content_block_delta") {
          const d = ev.delta;
          const acc = open.get(ev.index);
          if (d.type === "text_delta") {
            emitted = true;
            send({ t: "text", d: d.text });
          } else if (d.type === "input_json_delta" && acc?.kind === "tool_use") acc.json += d.partial_json;
          else if (d.type === "thinking_delta" && acc?.kind === "thinking") acc.thinking += d.thinking;
          else if (d.type === "signature_delta" && acc?.kind === "thinking") acc.signature = d.signature;
        } else if (ev.type === "content_block_stop") {
          const acc = open.get(ev.index);
          if (!acc) return;
          open.delete(ev.index);
          if (acc.kind === "thinking") send({ t: "thinking", thinking: acc.thinking, signature: acc.signature });
          else {
            try {
              const input = acc.json.trim() ? (JSON.parse(acc.json) as Record<string, unknown>) : {};
              send({ t: "tool_use", id: acc.id, name: acc.name, input });
            } catch {
              send({ t: "error", message: `The model produced an unreadable ${acc.name} call.` });
            }
          }
        } else if (ev.type === "message_delta" && ev.delta.stop_reason) {
          stopReason = ev.delta.stop_reason;
        }
      };
      try {
        if (!first.done) handle(first.value);
        for (let r = await events.next(); !r.done; r = await events.next()) handle(r.value);
        const tail = trailer(stopReason, emitted, parsed.json);
        if (tail) send({ t: "text", d: tail });
        send({ t: "stop", reason: stopReason });
        controller.close();
      } catch (err) {
        if (err instanceof Anthropic.APIUserAbortError || req.signal.aborted) {
          controller.close();
          return;
        }
        console.error("[api/ai] stream failed:", err instanceof Error ? err.name : "unknown error");
        try {
          send({ t: "error", message: "The connection to Anthropic dropped." });
          controller.close();
        } catch {
          controller.error(err);
        }
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
