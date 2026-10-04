import type { AiChatMessage, AiContentBlock, AiErrorCode, AiStreamEvent } from "./models";
import { addressSpace, providerById, type ProviderFamily, type ProviderId } from "./providers";
import type { AiToolDef } from "./tools";

// One chat turn against any provider, as a stream of Keel's own events. Pure
// fetch, no SDKs, no window or process: the route handler runs it as a relay
// and the browser runs it directly for local models and custom endpoints.
//
// The internal format is Anthropic-shaped (text, tool_use and tool_result
// blocks), because that is what the assistant already speaks; each family
// converts on the way out and normalises stop reasons on the way back:
// end_turn, tool_use, max_tokens, refusal. State only one provider can read
// (OpenAI's encrypted reasoning) travels as provider_state blocks, which every
// other family drops.

export interface ProviderCall {
  family: ProviderFamily;
  provider: ProviderId;
  baseUrl: string;
  apiKey?: string;
  model: string;
  system: string;
  messages: AiChatMessage[];
  tools: AiToolDef[];
  maxTokens: number;
  /** Set when the call is made from a browser rather than the relay. */
  browser?: boolean;
}

export class ProviderError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

// ----- shared plumbing -------------------------------------------------------

function short(message: string) {
  const one = message.replace(/\s+/g, " ").trim();
  return one.length > 240 ? `${one.slice(0, 239)}…` : one;
}

/** How errors name the provider: "Groq", "Ollama", "OpenAI"; a custom endpoint is "The endpoint". */
function labelFor(provider: ProviderId) {
  if (provider === "custom") return "The endpoint";
  return providerById(provider)?.label.replace(/ \(.*\)$/, "") ?? "The provider";
}

/** Map an HTTP failure to Keel's error codes, keeping the provider's own message. */
export async function errorFromHttp(res: Response, label: string): Promise<ProviderError> {
  let message = `${label} returned ${res.status}.`;
  try {
    const text = await res.text();
    try {
      const data = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      const m = typeof data.error === "string" ? data.error : (data.error?.message ?? data.message);
      if (m) message = short(m);
    } catch {
      if (text.trim()) message = short(text);
    }
  } catch {
    // Body unreadable; keep the generic message.
  }
  const s = res.status;
  // Gemini answers a bad key with 400 INVALID_ARGUMENT, "API key not valid".
  if (s === 401 || (s === 400 && /api[ _-]?key/i.test(message))) return new ProviderError("bad_key", message, 401);
  if (s === 403) return new ProviderError("forbidden", message, 403);
  if (s === 404) return new ProviderError("model_not_found", message, 404);
  if (s === 429) return new ProviderError("rate_limited", message, 429);
  if (s === 529 || s === 503) return new ProviderError("overloaded", message, 503);
  if (s === 400 || s === 413 || s === 422) return new ProviderError("bad_request", message, 400);
  return new ProviderError("server_error", message, s >= 400 && s <= 599 ? s : 502);
}

function isAbort(err: unknown) {
  return (err as { name?: string })?.name === "AbortError";
}

/**
 * Chrome 142+ asks before a public page may reach this machine or the local
 * network, and wants the fetch to say which it means. Other browsers ignore
 * the field; the relay never needs it.
 */
export function localNetworkInit(url: string, browser?: boolean): RequestInit {
  if (!browser) return {};
  let space: ReturnType<typeof addressSpace>;
  try {
    space = addressSpace(new URL(url).hostname);
  } catch {
    return {};
  }
  return space === "public" ? {} : ({ targetAddressSpace: space } as RequestInit);
}

async function post(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal | undefined, label: string, browser?: boolean) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
      ...localNetworkInit(url, browser),
    });
  } catch (err) {
    if (isAbort(err)) throw new ProviderError("aborted", "Stopped.");
    throw new ProviderError("upstream_unreachable", `Could not reach ${label}.`);
  }
  if (!res.ok) throw await errorFromHttp(res, label);
  if (!res.body) throw new ProviderError("server_error", `${label} sent an empty response.`);
  return res.body;
}

/** The data payloads of a server-sent event stream, one per event. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let data: string[] = [];
  const flushLine = function* (line: string): Generator<string> {
    if (line === "") {
      if (data.length) yield data.join("\n");
      data = [];
      return;
    }
    if (line.startsWith(":")) return;
    if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        yield* flushLine(line);
        nl = buf.indexOf("\n");
      }
    }
    buf += decoder.decode();
    if (buf) yield* flushLine(buf.replace(/\r$/, ""));
    yield* flushLine("");
  } finally {
    reader.releaseLock();
  }
}

function parseJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/** Reasoning models spend output tokens thinking; give them room so the answer is not starved. */
function roomForReasoning(maxTokens: number) {
  return Math.min(32_768, Math.max(4_096, maxTokens * 4));
}

const textOf = (blocks: AiContentBlock[]) =>
  blocks
    .filter((b): b is Extract<AiContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");

type ToolUseBlock = Extract<AiContentBlock, { type: "tool_use" }>;

const SYNTHETIC_ID_PREFIX = "keel_call_";

/** Ids for tool calls the provider sent without one. Unique per stream, because Anthropic refuses repeated tool_use ids. */
function syntheticIds() {
  const run = Math.random().toString(36).slice(2, 10);
  let n = 0;
  return () => `${SYNTHETIC_ID_PREFIX}${run}_${++n}`;
}

/** One finished call as an event: a tool_use, or an error when its arguments are not a JSON object. */
function toolEvent(id: string, name: string, args: string): AiStreamEvent {
  const input = args.trim() ? parseJson<unknown>(args) : {};
  if (input && typeof input === "object" && !Array.isArray(input)) return { t: "tool_use", id, name, input: input as Record<string, unknown> };
  return { t: "error", message: `The model produced an unreadable ${name || "tool"} call.` };
}

const NO_ANSWER = "(no answer)";

// ----- Anthropic Messages ----------------------------------------------------

/**
 * Whether a Claude model takes `thinking: {type: "adaptive"}`. Adaptive
 * thinking arrived with the 4.6 generation; Claude 3, every 4.x before 4.6 and
 * Haiku 4.5 reject it with a 400. Unknown names (a new family) are assumed
 * current.
 */
export function supportsAdaptiveThinking(model: string) {
  const id = model.toLowerCase();
  if (/^claude-(?:instant|[0-3](?:[-.]\d)?(?:-|$))/.test(id)) return false;
  const m = id.match(/^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/);
  if (!m) return true;
  const major = Number(m[2]);
  const minor = m[3] ? Number(m[3]) : 0;
  if (major >= 5) return true;
  if (major < 4 || m[1] === "haiku") return false;
  return minor >= 6;
}

export function toAnthropicMessages(messages: AiChatMessage[]) {
  return messages.map((m) => {
    if (typeof m.content === "string") return { role: m.role, content: m.content };
    const content = m.content.flatMap((b): Record<string, unknown>[] => {
      if (b.type === "provider_state") return [];
      if (b.type === "tool_use") return [{ type: "tool_use", id: b.id, name: b.name, input: b.input }];
      if (b.type === "tool_result") return [{ type: "tool_result", tool_use_id: b.tool_use_id, content: b.content, ...(b.is_error ? { is_error: true } : {}) }];
      if (b.type === "text" && !b.text) return [];
      return [b];
    });
    return { role: m.role, content: content.length ? content : NO_ANSWER };
  });
}

async function* anthropic(call: ProviderCall, signal?: AbortSignal): AsyncGenerator<AiStreamEvent> {
  const label = labelFor(call.provider);
  const body = {
    model: call.model,
    max_tokens: call.maxTokens,
    system: call.system,
    messages: toAnthropicMessages(call.messages),
    stream: true,
    ...(call.tools.length ? { tools: call.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema, strict: true })) } : {}),
    ...(supportsAdaptiveThinking(call.model) ? { thinking: { type: "adaptive" } } : {}),
  };
  const headers: Record<string, string> = { "x-api-key": call.apiKey ?? "", "anthropic-version": "2023-06-01" };
  if (call.browser) headers["anthropic-dangerous-direct-browser-access"] = "true";
  const stream = await post(`${call.baseUrl}/v1/messages`, headers, body, signal, label, call.browser);

  type Open = { kind: "tool_use"; id: string; name: string; json: string } | { kind: "thinking"; thinking: string; signature: string };
  const open = new Map<number, Open>();
  let stop: string | null = null;
  for await (const raw of sseData(stream)) {
    const ev = parseJson<Record<string, unknown> & { type?: string; index?: number }>(raw);
    if (!ev) continue;
    if (ev.type === "content_block_start") {
      const cb = ev.content_block as { type: string; id?: string; name?: string; thinking?: string; data?: string };
      if (cb.type === "tool_use") open.set(ev.index!, { kind: "tool_use", id: cb.id ?? "", name: cb.name ?? "", json: "" });
      else if (cb.type === "thinking") open.set(ev.index!, { kind: "thinking", thinking: cb.thinking ?? "", signature: "" });
      else if (cb.type === "redacted_thinking") yield { t: "redacted_thinking", data: cb.data ?? "" };
    } else if (ev.type === "content_block_delta") {
      const d = ev.delta as { type: string; text?: string; partial_json?: string; thinking?: string; signature?: string };
      const acc = open.get(ev.index!);
      if (d.type === "text_delta" && d.text) yield { t: "text", d: d.text };
      else if (d.type === "input_json_delta" && acc?.kind === "tool_use") acc.json += d.partial_json ?? "";
      else if (d.type === "thinking_delta" && acc?.kind === "thinking") acc.thinking += d.thinking ?? "";
      else if (d.type === "signature_delta" && acc?.kind === "thinking") acc.signature = d.signature ?? "";
    } else if (ev.type === "content_block_stop") {
      const acc = open.get(ev.index!);
      if (!acc) continue;
      open.delete(ev.index!);
      if (acc.kind === "thinking") yield { t: "thinking", thinking: acc.thinking, signature: acc.signature };
      else yield toolEvent(acc.id, acc.name, acc.json);
    } else if (ev.type === "message_delta") {
      const r = (ev.delta as { stop_reason?: string | null })?.stop_reason;
      if (r) stop = r;
    } else if (ev.type === "error") {
      const e = ev.error as { message?: string } | undefined;
      yield { t: "error", message: short(e?.message ?? `${label} reported an error.`) };
    }
  }
  yield { t: "stop", reason: stop };
}

// ----- OpenAI Chat Completions (and everything compatible) ------------------

type OaiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

export function toOpenAiMessages(system: string, messages: AiChatMessage[]): OaiMessage[] {
  const out: OaiMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push(m.role === "user" ? { role: "user", content: m.content } : { role: "assistant", content: m.content });
      continue;
    }
    if (m.role === "user") {
      // Tool results must directly follow the assistant turn that asked for them.
      for (const b of m.content) if (b.type === "tool_result") out.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.is_error ? `Error: ${b.content}` : b.content });
      const text = textOf(m.content);
      if (text) out.push({ role: "user", content: text });
    } else {
      const calls = m.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
      const text = textOf(m.content);
      out.push({
        role: "assistant",
        // An assistant turn needs content or tool calls; a thinking-only turn from another provider has neither.
        content: text || (calls.length ? null : NO_ANSWER),
        ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}),
      });
    }
  }
  return out;
}

export function mapOpenAiStop(reason: string | null, hadCalls: boolean): string | null {
  if (hadCalls) return "tool_use";
  if (reason === "length") return "max_tokens";
  if (reason === "content_filter") return "refusal";
  if (reason === "stop") return "end_turn";
  return reason;
}

/** Accumulates streamed tool-call fragments by index, as Chat Completions sends them. */
export class ToolCallFragments {
  private calls: { id: string; name: string; args: string }[] = [];
  private nextId = syntheticIds();
  add(fragments: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]) {
    for (const f of fragments) {
      // Gemini's compatibility endpoint omits `index`; fall back to the id, then to the call in progress.
      let i = typeof f.index === "number" ? f.index : f.id ? this.calls.findIndex((c) => c.id === f.id) : this.calls.length - 1;
      if (i < 0) i = this.calls.length;
      const c = (this.calls[i] ??= { id: "", name: "", args: "" });
      if (f.id) c.id = f.id;
      // The name arrives whole in the first fragment; later fragments carry arguments.
      if (f.function?.name && !c.name) c.name = f.function.name;
      if (f.function?.arguments) c.args += f.function.arguments;
    }
  }
  get size() {
    return this.calls.filter(Boolean).length;
  }
  *drain(): Generator<AiStreamEvent> {
    for (const c of this.calls) {
      if (!c) continue;
      yield toolEvent(c.id || this.nextId(), c.name, c.args);
    }
    this.calls = [];
  }
}

async function* openaiChat(call: ProviderCall, signal?: AbortSignal): AsyncGenerator<AiStreamEvent> {
  const label = labelFor(call.provider);
  let host = "";
  try {
    host = new URL(call.baseUrl).hostname;
  } catch {
    // The caller validated the URL; an unparsable one simply is not OpenAI.
  }
  const isOpenAi = call.provider === "openai" || /(^|\.)openai\.com$/.test(host);
  const body: Record<string, unknown> = {
    model: call.model,
    messages: toOpenAiMessages(call.system, call.messages),
    stream: true,
    ...(call.tools.length ? { tools: call.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })) } : {}),
  };
  // OpenAI's own reasoning models take max_completion_tokens and count reasoning
  // in it; everyone else still reads max_tokens.
  if (isOpenAi) body.max_completion_tokens = roomForReasoning(call.maxTokens);
  else body.max_tokens = call.maxTokens;
  const headers: Record<string, string> = {};
  if (call.apiKey) headers.authorization = `Bearer ${call.apiKey}`;
  if (call.provider === "openrouter") {
    headers["x-title"] = "Keel";
    headers["http-referer"] = "https://keel-six-amber.vercel.app";
  }
  const stream = await post(`${call.baseUrl}/chat/completions`, headers, body, signal, label, call.browser);

  const calls = new ToolCallFragments();
  let finish: string | null = null;
  for await (const raw of sseData(stream)) {
    if (raw.trim() === "[DONE]") break;
    const chunk = parseJson<{ choices?: { delta?: { content?: string | null; tool_calls?: unknown[] }; finish_reason?: string | null }[]; error?: { message?: string } }>(raw);
    if (!chunk) continue;
    if (chunk.error) {
      yield { t: "error", message: short(chunk.error.message ?? `${label} reported an error.`) };
      continue;
    }
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const d = choice.delta;
    if (d?.content) yield { t: "text", d: d.content };
    if (Array.isArray(d?.tool_calls)) calls.add(d.tool_calls as Parameters<ToolCallFragments["add"]>[0]);
    if (choice.finish_reason) finish = choice.finish_reason;
  }
  let hadCalls = false;
  for (const ev of calls.drain()) {
    if (ev.t === "tool_use") hadCalls = true;
    yield ev;
  }
  yield { t: "stop", reason: mapOpenAiStop(finish, hadCalls) };
}

// ----- OpenAI Responses -------------------------------------------------------
//
// OpenAI's current models call tools only through the Responses API. Keel runs
// it stateless (store: false), so the reasoning the model did before a tool
// call comes back as encrypted items that must be replayed on the next
// request; they ride on the assistant turn as provider_state blocks.

/** A reasoning item as replayed: only the fields the API documents, and only with its encrypted content. */
export interface ResponsesReasoningItem {
  type: "reasoning";
  id: string;
  summary: unknown[];
  encrypted_content: string;
}

/** Marker for the `phase` of the assistant message just before it, which GPT-6 wants round-tripped. */
interface ResponsesPhase {
  phase: "commentary" | "final_answer";
}

type ResponsesInputItem =
  | { role: "user" | "assistant"; content: string; phase?: ResponsesPhase["phase"] }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string }
  | ResponsesReasoningItem;

function replayableReasoning(item: unknown): ResponsesReasoningItem | null {
  const r = item as Partial<ResponsesReasoningItem> | null;
  if (!r || r.type !== "reasoning" || typeof r.id !== "string" || typeof r.encrypted_content !== "string" || !r.encrypted_content) return null;
  return { type: "reasoning", id: r.id, summary: Array.isArray(r.summary) ? r.summary : [], encrypted_content: r.encrypted_content };
}

const isReasoning = (item: ResponsesInputItem): item is ResponsesReasoningItem => "type" in item && item.type === "reasoning";

function phaseOf(data: unknown): ResponsesPhase["phase"] | null {
  const p = (data as { phase?: unknown } | null)?.phase;
  return p === "commentary" || p === "final_answer" ? p : null;
}

/**
 * Keel's history as Responses input items. Provider state is replayed only for
 * the provider that produced it, in its original position: reasoning before the
 * message or function calls that followed it.
 */
export function toResponsesInput(messages: AiChatMessage[], provider: string): ResponsesInputItem[] {
  const out: ResponsesInputItem[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === "user") {
      for (const b of m.content) {
        if (b.type === "tool_result") out.push({ type: "function_call_output", call_id: b.tool_use_id, output: b.is_error ? `Error: ${b.content}` : b.content });
      }
      const text = textOf(m.content);
      if (text) out.push({ role: "user", content: text });
      continue;
    }
    const turn: ResponsesInputItem[] = [];
    let lastMessage: Extract<ResponsesInputItem, { role: string }> | null = null;
    for (const b of m.content) {
      if (b.type === "text" && b.text) {
        lastMessage = { role: "assistant", content: b.text };
        turn.push(lastMessage);
      } else if (b.type === "tool_use") {
        turn.push({ type: "function_call", call_id: b.id, name: b.name, arguments: JSON.stringify(b.input) });
      } else if (b.type === "provider_state" && b.provider === provider) {
        const reasoning = replayableReasoning(b.data);
        const phase = phaseOf(b.data);
        if (reasoning) turn.push(reasoning);
        else if (phase && lastMessage && !lastMessage.phase) lastMessage.phase = phase;
      }
    }
    // A reasoning item must be followed by the item it led to; a turn cut off
    // mid-thought ends in one, and the API refuses that.
    while (turn.length && isReasoning(turn[turn.length - 1])) turn.pop();
    out.push(...turn);
  }
  return out;
}

export function mapResponsesStop(s: { hadCalls: boolean; incompleteReason: string | null; refused: boolean }): string {
  if (s.hadCalls) return "tool_use";
  if (s.incompleteReason === "max_output_tokens") return "max_tokens";
  if (s.incompleteReason === "content_filter" || s.refused) return "refusal";
  return "end_turn";
}

const STRICT_UNSUPPORTED_FINE_TUNED = new Set(["minLength", "maxLength", "pattern", "format", "minimum", "maximum", "multipleOf", "patternProperties", "minItems", "maxItems"]);

/** Fine-tuned models reject some keywords under strict mode that base models accept; drop them there. */
function strictSchemaFor(model: string, schema: unknown): unknown {
  if (!model.startsWith("ft:")) return schema;
  const strip = (s: unknown): unknown => {
    if (Array.isArray(s)) return s.map(strip);
    if (!s || typeof s !== "object") return s;
    return Object.fromEntries(
      Object.entries(s as Record<string, unknown>)
        .filter(([k]) => !STRICT_UNSUPPORTED_FINE_TUNED.has(k))
        .map(([k, v]) => [k, k === "properties" && v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, strip(pv)])) : strip(v)]),
    );
  };
  return strip(schema);
}

/** OpenAI suggests reserving at least 25,000 tokens for reasoning and output; it is a cap, not a charge. */
function responsesOutputBudget(maxTokens: number) {
  return Math.max(25_000, roomForReasoning(maxTokens));
}

async function* openaiResponses(call: ProviderCall, signal?: AbortSignal): AsyncGenerator<AiStreamEvent> {
  const label = labelFor(call.provider);
  const body: Record<string, unknown> = {
    model: call.model,
    ...(call.system ? { instructions: call.system } : {}),
    input: toResponsesInput(call.messages, call.provider),
    ...(call.tools.length
      ? { tools: call.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: strictSchemaFor(call.model, t.input_schema), strict: true })) }
      : {}),
    stream: true,
    max_output_tokens: responsesOutputBudget(call.maxTokens),
    store: false,
    // Returned by default when store is false; asked for explicitly so older snapshots send it too.
    include: ["reasoning.encrypted_content"],
  };
  const headers: Record<string, string> = {};
  if (call.apiKey) headers.authorization = `Bearer ${call.apiKey}`;
  const stream = await post(`${call.baseUrl}/responses`, headers, body, signal, label, call.browser);

  type Pending = { callId: string; name: string; args: string };
  const pending = new Map<string, Pending>();
  const byIndex = new Map<number, string>();
  const keyOf = (itemId: unknown, index: unknown) => (typeof itemId === "string" ? itemId : typeof index === "number" ? byIndex.get(index) : undefined);
  const nextId = syntheticIds();
  let hadCalls = false;
  let refused = false;
  let incompleteReason: string | null = null;
  for await (const raw of sseData(stream)) {
    const ev = parseJson<Record<string, unknown> & { type?: string }>(raw);
    if (!ev) continue;
    switch (ev.type) {
      case "response.output_text.delta":
        if (typeof ev.delta === "string" && ev.delta) yield { t: "text", d: ev.delta };
        break;
      case "response.refusal.delta":
        refused = true;
        if (typeof ev.delta === "string" && ev.delta) yield { t: "text", d: ev.delta };
        break;
      case "response.output_item.added": {
        const item = ev.item as { type?: string; id?: string; call_id?: string; name?: string } | undefined;
        if (item?.type !== "function_call") break;
        const key = item.id ?? `index_${String(ev.output_index)}`;
        pending.set(key, { callId: item.call_id ?? "", name: item.name ?? "", args: "" });
        if (typeof ev.output_index === "number") byIndex.set(ev.output_index, key);
        break;
      }
      case "response.function_call_arguments.delta": {
        const p = pending.get(keyOf(ev.item_id, ev.output_index) ?? "");
        if (p && typeof ev.delta === "string") p.args += ev.delta;
        break;
      }
      case "response.function_call_arguments.done": {
        const p = pending.get(keyOf(ev.item_id, ev.output_index) ?? "");
        if (p && typeof ev.arguments === "string") p.args = ev.arguments;
        break;
      }
      case "response.output_item.done": {
        const item = ev.item as { type?: string; id?: string; call_id?: string; name?: string; arguments?: string; phase?: unknown; content?: { type?: string }[] } | undefined;
        if (!item) break;
        if (item.type === "function_call") {
          const key = keyOf(item.id, ev.output_index) ?? "";
          const p = pending.get(key);
          pending.delete(key);
          const out = toolEvent(item.call_id || p?.callId || nextId(), item.name || p?.name || "", typeof item.arguments === "string" ? item.arguments : (p?.args ?? ""));
          if (out.t === "tool_use") hadCalls = true;
          yield out;
        } else if (item.type === "reasoning") {
          const reasoning = replayableReasoning(item);
          if (reasoning) yield { t: "provider_state", provider: call.provider, data: reasoning };
        } else if (item.type === "message") {
          if (item.content?.some((c) => c.type === "refusal")) refused = true;
          const phase = phaseOf(item);
          if (phase) yield { t: "provider_state", provider: call.provider, data: { phase } satisfies ResponsesPhase };
        }
        break;
      }
      case "response.completed":
      case "response.incomplete": {
        const r = ev.response as { incomplete_details?: { reason?: string } | null } | undefined;
        incompleteReason = r?.incomplete_details?.reason ?? null;
        break;
      }
      case "response.failed": {
        const e = (ev.response as { error?: { message?: string } | null } | undefined)?.error;
        yield { t: "error", message: short(e?.message ?? `${label} could not complete the response.`) };
        break;
      }
      case "error": {
        const m = typeof ev.message === "string" ? ev.message : (ev.error as { message?: string } | undefined)?.message;
        yield { t: "error", message: short(m ?? `${label} reported an error.`) };
        break;
      }
    }
  }
  // A stream cut before an item finished: keep the calls whose arguments parse.
  for (const p of pending.values()) {
    const out = toolEvent(p.callId || nextId(), p.name, p.args);
    if (out.t === "tool_use") hadCalls = true;
    yield out;
  }
  yield { t: "stop", reason: mapResponsesStop({ hadCalls, incompleteReason, refused }) };
}

// ----- Gemini generateContent ------------------------------------------------

/** Documented stand-in for a thought signature on a call Gemini did not make (history from another provider). */
export const GEMINI_SKIP_SIGNATURE = "skip_thought_signature_validator";

/**
 * Tool schemas for `parametersJsonSchema`, which takes JSON Schema as written
 * (type arrays, additionalProperties). The one rewrite: Gemini documents enum
 * as a list of strings or numbers, so a nullable enum becomes an anyOf of the
 * enum and null, which says the same thing.
 */
export function toGeminiJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiJsonSchema);
  if (!schema || typeof schema !== "object") return schema;
  const s: Record<string, unknown> = { ...(schema as Record<string, unknown>) };
  if (s.properties && typeof s.properties === "object") {
    s.properties = Object.fromEntries(Object.entries(s.properties as Record<string, unknown>).map(([k, v]) => [k, toGeminiJsonSchema(v)]));
  }
  if (s.items) s.items = toGeminiJsonSchema(s.items);
  if (Array.isArray(s.anyOf)) s.anyOf = s.anyOf.map(toGeminiJsonSchema);
  if (Array.isArray(s.enum) && s.enum.includes(null)) {
    const { enum: values, type, ...rest } = s as { enum: unknown[]; type?: unknown } & Record<string, unknown>;
    const types = (Array.isArray(type) ? type : [type]).filter((t) => typeof t === "string" && t !== "null");
    return {
      ...rest,
      anyOf: [{ ...(types.length ? { type: types.length === 1 ? types[0] : types } : {}), enum: values.filter((v) => v !== null) }, { type: "null" }],
    };
  }
  return s;
}

type GeminiPart =
  | { text: string; thought?: boolean; thoughtSignature?: string }
  | { functionCall: { name: string; args: Record<string, unknown>; id?: string }; thoughtSignature?: string }
  | { functionResponse: { name: string; response: Record<string, unknown>; id?: string } };

/** Gemini 1.x and 2.x never validated signatures and may not know the placeholder. */
function validatesSignatures(model: string) {
  return !/^gemini-[12](?:[.-]|$)/.test(model);
}

/** Whether an id came from the provider rather than from Keel filling a gap. */
const realId = (id: string) => Boolean(id) && !id.startsWith(SYNTHETIC_ID_PREFIX);

/**
 * Keel's history as Gemini contents. Each assistant turn keeps its calls in
 * order and the next user turn its responses in the same order (FC1, FC2 then
 * FR1, FR2), which parallel calls require.
 */
export function toGeminiContents(messages: AiChatMessage[], model = "") {
  const names = new Map<string, string>();
  const placeholder = validatesSignatures(model);
  const out: { role: "user" | "model"; parts: GeminiPart[] }[] = [];
  for (const m of messages) {
    const role = m.role === "user" ? "user" : "model";
    if (typeof m.content === "string") {
      out.push({ role, parts: [{ text: m.content }] });
      continue;
    }
    const parts: GeminiPart[] = [];
    let firstCall = true;
    for (const b of m.content) {
      if (b.type === "text" && b.text) parts.push({ text: b.text });
      else if (b.type === "tool_use") {
        names.set(b.id, b.name);
        // Gemini signs the first call of a step; a call it did not make gets the placeholder in that place.
        const signature = b.signature ?? (firstCall && placeholder ? GEMINI_SKIP_SIGNATURE : undefined);
        firstCall = false;
        parts.push({ functionCall: { name: b.name, args: b.input, ...(realId(b.id) ? { id: b.id } : {}) }, ...(signature ? { thoughtSignature: signature } : {}) });
      } else if (b.type === "tool_result") {
        parts.push({
          functionResponse: {
            name: names.get(b.tool_use_id) ?? "tool",
            response: b.is_error ? { error: b.content } : { result: b.content },
            ...(realId(b.tool_use_id) ? { id: b.tool_use_id } : {}),
          },
        });
      }
    }
    if (parts.length) out.push({ role, parts });
  }
  return out;
}

const GEMINI_REFUSAL = /SAFETY|RECITATION|PROHIBITED|BLOCKLIST|SPII|LANGUAGE|ESCALATION|PUP_LIMITED/;

/** Finish reasons that mean the turn failed rather than ended, with what to tell the person. */
const GEMINI_FAILURES: Record<string, string> = {
  MALFORMED_FUNCTION_CALL: "Gemini produced a tool call it could not complete. Try again, or ask more simply.",
  MISSING_THOUGHT_SIGNATURE: "Gemini needs the thought signature of an earlier tool call, and this conversation does not have it. Start a new chat to continue.",
  UNEXPECTED_TOOL_CALL: "Gemini tried to call a tool that this request does not offer.",
  TOO_MANY_TOOL_CALLS: "Gemini stopped after too many tool calls in a row.",
  MALFORMED_RESPONSE: "Gemini sent a malformed response. Try again.",
};

export function mapGeminiStop(finish: string | null, calls: number, blocked: boolean): string {
  if (calls) return "tool_use";
  if (blocked || (finish && GEMINI_REFUSAL.test(finish))) return "refusal";
  if (finish === "MAX_TOKENS") return "max_tokens";
  return "end_turn";
}

async function* gemini(call: ProviderCall, signal?: AbortSignal): AsyncGenerator<AiStreamEvent> {
  const label = labelFor(call.provider);
  const body = {
    systemInstruction: { parts: [{ text: call.system }] },
    contents: toGeminiContents(call.messages, call.model),
    ...(call.tools.length
      ? { tools: [{ functionDeclarations: call.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: toGeminiJsonSchema(t.input_schema) })) }] }
      : {}),
    generationConfig: { maxOutputTokens: roomForReasoning(call.maxTokens) },
  };
  const url = `${call.baseUrl}/models/${encodeURIComponent(call.model)}:streamGenerateContent?alt=sse`;
  const stream = await post(url, { "x-goog-api-key": call.apiKey ?? "" }, body, signal, label, call.browser);

  const nextId = syntheticIds();
  let n = 0;
  let finish: string | null = null;
  let finishMessage = "";
  let blocked = false;
  for await (const raw of sseData(stream)) {
    const chunk = parseJson<{
      candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string; finishMessage?: string }[];
      promptFeedback?: { blockReason?: string };
      error?: { message?: string };
    }>(raw);
    if (!chunk) continue;
    if (chunk.error) {
      yield { t: "error", message: short(chunk.error.message ?? `${label} reported an error.`) };
      continue;
    }
    if (chunk.promptFeedback?.blockReason) blocked = true;
    const cand = chunk.candidates?.[0];
    for (const p of cand?.content?.parts ?? []) {
      if ("functionCall" in p) {
        n += 1;
        yield {
          t: "tool_use",
          id: p.functionCall.id || nextId(),
          name: p.functionCall.name,
          input: p.functionCall.args ?? {},
          ...(p.thoughtSignature ? { signature: p.thoughtSignature } : {}),
        };
      } else if ("text" in p && p.text && !p.thought) {
        yield { t: "text", d: p.text };
      }
    }
    if (cand?.finishReason) finish = cand.finishReason;
    if (cand?.finishMessage) finishMessage = cand.finishMessage;
  }
  const failure = finish ? GEMINI_FAILURES[finish] : undefined;
  if (failure) yield { t: "error", message: finishMessage ? `${failure} (${short(finishMessage)})` : failure };
  yield { t: "stop", reason: mapGeminiStop(finish, n, blocked) };
}

// ----- entry points ----------------------------------------------------------

export function streamProvider(call: ProviderCall, signal?: AbortSignal): AsyncGenerator<AiStreamEvent> {
  switch (call.family) {
    case "anthropic":
      return anthropic(call, signal);
    case "gemini":
      return gemini(call, signal);
    case "openai-responses":
      return openaiResponses(call, signal);
    case "openai":
      return openaiChat(call, signal);
  }
}

/** Model ids the endpoint offers, for the picker. */
export async function listModels(c: Pick<ProviderCall, "family" | "provider" | "baseUrl" | "apiKey" | "browser">, signal?: AbortSignal): Promise<string[]> {
  const label = labelFor(c.provider);
  let url: string;
  const headers: Record<string, string> = {};
  if (c.family === "anthropic") {
    url = `${c.baseUrl}/v1/models?limit=100`;
    headers["x-api-key"] = c.apiKey ?? "";
    headers["anthropic-version"] = "2023-06-01";
    if (c.browser) headers["anthropic-dangerous-direct-browser-access"] = "true";
  } else if (c.family === "gemini") {
    url = `${c.baseUrl}/models?pageSize=200`;
    headers["x-goog-api-key"] = c.apiKey ?? "";
  } else {
    // Chat Completions and Responses share OpenAI's model list.
    url = `${c.baseUrl}/models`;
    if (c.apiKey) headers.authorization = `Bearer ${c.apiKey}`;
  }
  let res: Response;
  try {
    res = await fetch(url, { headers, signal, ...localNetworkInit(url, c.browser) });
  } catch (err) {
    if (isAbort(err)) throw new ProviderError("aborted", "Stopped.");
    throw new ProviderError("upstream_unreachable", `Could not reach ${label}.`);
  }
  if (!res.ok) throw await errorFromHttp(res, label);
  const data = (await res.json()) as { data?: { id?: string }[]; models?: { name?: string; supportedGenerationMethods?: string[] }[] };
  if (c.family === "gemini") {
    return (data.models ?? [])
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent"))
      .map((m) => (m.name ?? "").replace(/^models\//, ""))
      .filter(Boolean);
  }
  return (data.data ?? []).map((m) => m.id ?? "").filter(Boolean);
}
