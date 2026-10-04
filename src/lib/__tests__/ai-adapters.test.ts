import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GEMINI_SKIP_SIGNATURE,
  ProviderError,
  errorFromHttp,
  localNetworkInit,
  sseData,
  streamProvider,
  supportsAdaptiveThinking,
  toAnthropicMessages,
  toGeminiContents,
  toOpenAiMessages,
  toResponsesInput,
  type ProviderCall,
} from "../ai/adapters";
import type { AiChatMessage, AiStreamEvent } from "../ai/models";
import { addressSpace } from "../ai/providers";
import { toolByName } from "../ai/tools";
import { TurnAccumulator } from "../ai/turn";

// Every family against a fetch that replays SSE fixtures written here, so the
// wire formats are pinned without a network. Chunks are cut at odd byte
// offsets to prove the parser buffers across reads, including mid-character.

const encoder = new TextEncoder();

function stream(text: string, chunkBytes = 23): ReadableStream<Uint8Array> {
  const bytes = encoder.encode(text);
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(at, at + chunkBytes));
      at += chunkBytes;
    },
  });
}

/** One `data:` event per payload, optionally named, blank-line separated. */
function sse(events: (object | string | [string, object])[]) {
  return events
    .map((e) => {
      if (Array.isArray(e)) return `event: ${e[0]}\ndata: ${JSON.stringify(e[1])}\n\n`;
      return `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`;
    })
    .join("");
}

const sseResponse = (text: string, chunkBytes?: number) => new Response(stream(text, chunkBytes), { status: 200, headers: { "content-type": "text/event-stream" } });

/** Stub fetch with responses served in order; returns the recorded calls. */
function mockFetch(...responses: Response[]) {
  const fn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return next;
  });
  vi.stubGlobal("fetch", fn);
  return {
    url: (i: number) => fn.mock.calls[i][0],
    init: (i: number) => fn.mock.calls[i][1] as RequestInit & Record<string, unknown>,
    body: (i: number) => JSON.parse(String(fn.mock.calls[i][1]?.body)) as Record<string, unknown>,
    headers: (i: number) => fn.mock.calls[i][1]?.headers as Record<string, string>,
    count: () => fn.mock.calls.length,
  };
}

async function collect(gen: AsyncGenerator<AiStreamEvent>) {
  const out: AiStreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

function assistantTurn(events: AiStreamEvent[]): AiChatMessage {
  const acc = new TurnAccumulator();
  for (const ev of events) acc.apply(ev);
  return { role: "assistant", content: acc.finish().blocks };
}

const tool = (name: string) => toolByName(name)!;

function call(overrides: Partial<ProviderCall>): ProviderCall {
  return {
    family: "anthropic",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKey: "test-key",
    model: "claude-opus-5-5",
    system: "You are Keel's assistant.",
    messages: [{ role: "user", content: "Log the decision." }],
    tools: [],
    maxTokens: 4096,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ----- Anthropic ---------------------------------------------------------------

describe("Anthropic Messages", () => {
  it("streams thinking with its signature, text, a tool call split across input_json_delta, and the stop reason", async () => {
    const http = mockFetch(
      sseResponse(
        sse([
          ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", content: [], stop_reason: null } }],
          ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }],
          ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "The user wants " } }],
          ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "a decision logged." } }],
          ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-abc" } }],
          ["content_block_stop", { type: "content_block_stop", index: 0 }],
          ["ping", { type: "ping" }],
          ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }],
          ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "سأسجّل " } }],
          ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "القرار." } }],
          ["content_block_stop", { type: "content_block_stop", index: 1 }],
          ["content_block_start", { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_01", name: "log_decision", input: {} } }],
          ["content_block_delta", { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "" } }],
          ["content_block_delta", { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"title":"Use SQLite",' } }],
          ["content_block_delta", { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '"status":"acc' } }],
          ["content_block_delta", { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: 'epted"}' } }],
          ["content_block_stop", { type: "content_block_stop", index: 2 }],
          ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 42 } }],
          ["message_stop", { type: "message_stop" }],
        ]),
        7,
      ),
    );
    const events = await collect(streamProvider(call({ tools: [tool("log_decision")] })));
    expect(events).toEqual([
      { t: "thinking", thinking: "The user wants a decision logged.", signature: "sig-abc" },
      { t: "text", d: "سأسجّل " },
      { t: "text", d: "القرار." },
      { t: "tool_use", id: "toolu_01", name: "log_decision", input: { title: "Use SQLite", status: "accepted" } },
      { t: "stop", reason: "tool_use" },
    ]);
    expect(http.url(0)).toBe("https://api.anthropic.com/v1/messages");
    expect(http.headers(0)["x-api-key"]).toBe("test-key");
    const body = http.body(0);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.tools).toEqual([{ name: "log_decision", description: tool("log_decision").description, input_schema: tool("log_decision").input_schema, strict: true }]);
    expect(body).not.toHaveProperty("temperature");
  });

  it("omits adaptive thinking for models that reject it", async () => {
    const http = mockFetch(sseResponse(sse([{ type: "message_delta", delta: { stop_reason: "end_turn" } }])));
    await collect(streamProvider(call({ model: "claude-haiku-4-5" })));
    expect(http.body(0)).not.toHaveProperty("thinking");
  });

  it("knows which model ids take adaptive thinking", () => {
    for (const id of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-opus-4-6", "claude-sonnet-4-6", "claude-opus-4-7"]) expect(supportsAdaptiveThinking(id), id).toBe(true);
    for (const id of [
      "claude-haiku-4-5",
      "claude-haiku-4-5-20251001",
      "claude-opus-4-5-20251101",
      "claude-sonnet-4-5",
      "claude-opus-4-1-20250805",
      "claude-sonnet-4-20250514",
      "claude-3-7-sonnet-20250219",
      "claude-3-haiku-20240307",
      "claude-2.1",
      "claude-instant-1.2",
    ])
      expect(supportsAdaptiveThinking(id), id).toBe(false);
  });

  it("drops other providers' state and never sends an empty assistant turn", () => {
    const out = toAnthropicMessages([
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "provider_state", provider: "openai", data: { type: "reasoning" } }] },
      {
        role: "assistant",
        content: [
          { type: "provider_state", provider: "openai", data: {} },
          { type: "tool_use", id: "fc-1", name: "log_decision", input: {}, signature: "gemini-sig" },
        ],
      },
    ]);
    expect(out[1]).toEqual({ role: "assistant", content: "(no answer)" });
    expect(out[2]).toEqual({ role: "assistant", content: [{ type: "tool_use", id: "fc-1", name: "log_decision", input: {} }] });
  });
});

// ----- Chat Completions -----------------------------------------------------------

describe("Chat Completions", () => {
  const chunk = (delta: object, finish: string | null = null) => ({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] });

  it("streams text and a tool call whose arguments arrive in three indexed fragments, through [DONE]", async () => {
    const text =
      ": OPENROUTER PROCESSING\n\n" +
      sse([
        chunk({ role: "assistant", content: "" }),
        chunk({ content: "Adding " }),
        chunk({ content: "the risk." }),
        chunk({ tool_calls: [{ index: 0, id: "call_abc", type: "function", function: { name: "add_risk", arguments: '{"projectKey":null,' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '"title":"Vendor slips","kind":"risk",' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '"likelihood":3,"impact":4,"mitigation":null}' } }] }),
        chunk({}, "tool_calls"),
        "[DONE]",
      ]);
    const http = mockFetch(sseResponse(text, 11));
    const events = await collect(
      streamProvider(call({ family: "openai", provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/auto", tools: [tool("add_risk")] })),
    );
    expect(events).toEqual([
      { t: "text", d: "Adding " },
      { t: "text", d: "the risk." },
      { t: "tool_use", id: "call_abc", name: "add_risk", input: { projectKey: null, title: "Vendor slips", kind: "risk", likelihood: 3, impact: 4, mitigation: null } },
      { t: "stop", reason: "tool_use" },
    ]);
    expect(http.url(0)).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(http.headers(0).authorization).toBe("Bearer test-key");
    const body = http.body(0);
    expect(body.max_tokens).toBe(4096);
    expect(body.tools).toEqual([{ type: "function", function: { name: "add_risk", description: tool("add_risk").description, parameters: tool("add_risk").input_schema } }]);
    expect(body.messages).toEqual([
      { role: "system", content: "You are Keel's assistant." },
      { role: "user", content: "Log the decision." },
    ]);
  });

  it("assembles fragments with no index, as Gemini's compatibility endpoint sends them, two calls in a row", async () => {
    const text = sse([
      chunk({ tool_calls: [{ id: "call_1", type: "function", function: { name: "log_decision", arguments: '{"title":' } }] }),
      chunk({ tool_calls: [{ function: { arguments: '"One"' } }] }),
      chunk({ tool_calls: [{ function: { arguments: "}" } }] }),
      chunk({ tool_calls: [{ id: "call_2", type: "function", function: { name: "log_decision", arguments: '{"title":"Two"}' } }] }),
      chunk({}, "stop"),
      "[DONE]",
    ]);
    mockFetch(sseResponse(text));
    const events = await collect(
      streamProvider(call({ family: "openai", provider: "custom", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.8-flash", tools: [tool("log_decision")] })),
    );
    expect(events).toEqual([
      { t: "tool_use", id: "call_1", name: "log_decision", input: { title: "One" } },
      { t: "tool_use", id: "call_2", name: "log_decision", input: { title: "Two" } },
      { t: "stop", reason: "tool_use" },
    ]);
  });

  it("maps finish reasons and replays history with tool results right after their call", async () => {
    mockFetch(sseResponse(sse([chunk({ content: "Cut" }), chunk({}, "length"), "[DONE]"])));
    const events = await collect(streamProvider(call({ family: "openai", provider: "groq", baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-20b" })));
    expect(events.at(-1)).toEqual({ t: "stop", reason: "max_tokens" });

    const msgs = toOpenAiMessages("sys", [
      { role: "user", content: "Do it" },
      {
        role: "assistant",
        content: [
          { type: "provider_state", provider: "openai", data: { type: "reasoning" } },
          { type: "text", text: "On it." },
          { type: "tool_use", id: "call_9", name: "log_decision", input: { title: "X" } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_9", content: "Logged.", is_error: false }] },
    ]);
    expect(msgs.slice(2)).toEqual([
      { role: "assistant", content: "On it.", tool_calls: [{ id: "call_9", type: "function", function: { name: "log_decision", arguments: '{"title":"X"}' } }] },
      { role: "tool", tool_call_id: "call_9", content: "Logged." },
    ]);
  });
});

// ----- OpenAI Responses -------------------------------------------------------------

describe("OpenAI Responses", () => {
  const ARGS = '{"title":"Use SQLite","status":"accepted"}';
  const REASONING = { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "gAAAA-encrypted-1" };
  const responsesCall = (messages: AiChatMessage[]) =>
    call({ family: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-6-astra", messages, tools: [tool("log_decision")] });

  const firstTurn = sse([
    ["response.created", { type: "response.created", sequence_number: 0, response: { id: "resp_1", status: "in_progress" } }],
    ["response.output_item.added", { type: "response.output_item.added", output_index: 0, item: { type: "reasoning", id: "rs_1", summary: [] } }],
    ["response.output_item.done", { type: "response.output_item.done", output_index: 0, item: { ...REASONING, status: "completed" } }],
    ["response.output_item.added", { type: "response.output_item.added", output_index: 1, item: { type: "message", id: "msg_1", role: "assistant", content: [], phase: "commentary" } }],
    ["response.output_text.delta", { type: "response.output_text.delta", item_id: "msg_1", output_index: 1, content_index: 0, delta: "I'll log " }],
    ["response.output_text.delta", { type: "response.output_text.delta", item_id: "msg_1", output_index: 1, content_index: 0, delta: "that." }],
    [
      "response.output_item.done",
      {
        type: "response.output_item.done",
        output_index: 1,
        item: { type: "message", id: "msg_1", role: "assistant", status: "completed", phase: "commentary", content: [{ type: "output_text", text: "I'll log that.", annotations: [] }] },
      },
    ],
    ["response.output_item.added", { type: "response.output_item.added", output_index: 2, item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "log_decision", arguments: "" } }],
    ["response.function_call_arguments.delta", { type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 2, delta: '{"title":' }],
    ["response.function_call_arguments.delta", { type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 2, delta: '"Use SQLite","status":' }],
    ["response.function_call_arguments.delta", { type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 2, delta: '"accepted"}' }],
    ["response.function_call_arguments.done", { type: "response.function_call_arguments.done", item_id: "fc_1", output_index: 2, arguments: ARGS }],
    [
      "response.output_item.done",
      { type: "response.output_item.done", output_index: 2, item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "log_decision", arguments: ARGS, status: "completed" } },
    ],
    ["response.completed", { type: "response.completed", response: { id: "resp_1", status: "completed", incomplete_details: null } }],
  ]);

  it("streams reasoning state, text with its phase, and a function call, then replays all of it on the next request", async () => {
    const http = mockFetch(
      sseResponse(firstTurn, 13),
      sseResponse(
        sse([
          { type: "response.output_text.delta", item_id: "msg_2", output_index: 0, content_index: 0, delta: "Logged as ADR-4." },
          { type: "response.completed", response: { id: "resp_2", status: "completed", incomplete_details: null } },
        ]),
      ),
    );
    const user: AiChatMessage = { role: "user", content: "Log that we chose SQLite." };
    const first = await collect(streamProvider(responsesCall([user])));
    expect(first).toEqual([
      { t: "provider_state", provider: "openai", data: REASONING },
      { t: "text", d: "I'll log " },
      { t: "text", d: "that." },
      { t: "provider_state", provider: "openai", data: { phase: "commentary" } },
      { t: "tool_use", id: "call_1", name: "log_decision", input: { title: "Use SQLite", status: "accepted" } },
      { t: "stop", reason: "tool_use" },
    ]);

    const req = http.body(0);
    expect(http.url(0)).toBe("https://api.openai.com/v1/responses");
    expect(http.headers(0).authorization).toBe("Bearer test-key");
    expect(req).toMatchObject({ model: "gpt-6-astra", instructions: "You are Keel's assistant.", stream: true, store: false, include: ["reasoning.encrypted_content"] });
    expect(req.input).toEqual([{ role: "user", content: "Log that we chose SQLite." }]);
    expect(req.tools).toEqual([{ type: "function", name: "log_decision", description: tool("log_decision").description, parameters: tool("log_decision").input_schema, strict: true }]);
    expect(req.max_output_tokens as number).toBeGreaterThanOrEqual(25_000);
    expect(req).not.toHaveProperty("temperature");
    expect(req).not.toHaveProperty("messages");

    const second = await collect(
      streamProvider(responsesCall([user, assistantTurn(first), { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "Logged as ADR-4." }] }])),
    );
    expect(second).toEqual([
      { t: "text", d: "Logged as ADR-4." },
      { t: "stop", reason: "end_turn" },
    ]);
    expect(http.body(1).input).toEqual([
      { role: "user", content: "Log that we chose SQLite." },
      REASONING,
      { role: "assistant", content: "I'll log that.", phase: "commentary" },
      { type: "function_call", call_id: "call_1", name: "log_decision", arguments: ARGS },
      { type: "function_call_output", call_id: "call_1", output: "Logged as ADR-4." },
    ]);
  });

  it("maps an incomplete response to max_tokens and passes stream errors through", async () => {
    mockFetch(
      sseResponse(
        sse([
          { type: "response.output_text.delta", delta: "Partial" },
          { type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } },
        ]),
      ),
      sseResponse(sse([{ type: "error", code: "server_error", message: "The server had an error.", param: null }])),
      sseResponse(sse([{ type: "response.failed", response: { status: "failed", error: { code: "server_error", message: "Something broke." } } }])),
    );
    expect(await collect(streamProvider(responsesCall([{ role: "user", content: "x" }])))).toEqual([
      { t: "text", d: "Partial" },
      { t: "stop", reason: "max_tokens" },
    ]);
    expect(await collect(streamProvider(responsesCall([{ role: "user", content: "x" }])))).toEqual([
      { t: "error", message: "The server had an error." },
      { t: "stop", reason: "end_turn" },
    ]);
    expect(await collect(streamProvider(responsesCall([{ role: "user", content: "x" }])))).toEqual([
      { t: "error", message: "Something broke." },
      { t: "stop", reason: "end_turn" },
    ]);
  });

  it("replays only its own provider's reasoning, never a trailing one, and strips unknown fields", () => {
    const input = toResponsesInput(
      [
        { role: "user", content: "a" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "claude thoughts", signature: "s" },
            { type: "provider_state", provider: "openrouter", data: REASONING },
            { type: "provider_state", provider: "openai", data: { ...REASONING, id: "rs_2", injected: "x", content: [{ type: "reasoning_text", text: "raw" }] } },
            { type: "text", text: "Answer." },
            { type: "provider_state", provider: "openai", data: { ...REASONING, id: "rs_3" } },
          ],
        },
        { role: "user", content: "b" },
      ],
      "openai",
    );
    expect(input).toEqual([
      { role: "user", content: "a" },
      { type: "reasoning", id: "rs_2", summary: [], encrypted_content: "gAAAA-encrypted-1" },
      { role: "assistant", content: "Answer." },
      { role: "user", content: "b" },
    ]);
  });
});

// ----- Gemini --------------------------------------------------------------------------

describe("Gemini generateContent", () => {
  const RISK_A = { projectKey: null, title: "Vendor slips", kind: "risk", likelihood: 3, impact: 4, mitigation: null };
  const RISK_B = { ...RISK_A, title: "Key person leaves", likelihood: 2 };
  const geminiCall = (messages: AiChatMessage[], model = "gemini-3.8-flash") =>
    call({
      family: "gemini",
      provider: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model,
      messages,
      tools: [tool("add_risk"), tool("update_issue")],
    });

  it("streams text and parallel function calls with the thought signature, then replays FC1, FC2 before FR1, FR2", async () => {
    const http = mockFetch(
      sseResponse(
        sse([
          { candidates: [{ content: { role: "model", parts: [{ text: "Weighing the risks…", thought: true }] } }] },
          { candidates: [{ content: { role: "model", parts: [{ text: "Adding " }] } }] },
          { candidates: [{ content: { role: "model", parts: [{ text: "two risks." }] } }] },
          {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    { functionCall: { id: "fc-a", name: "add_risk", args: RISK_A }, thoughtSignature: "c2lnLWE=" },
                    { functionCall: { id: "fc-b", name: "add_risk", args: RISK_B } },
                  ],
                },
                finishReason: "STOP",
              },
            ],
            usageMetadata: { totalTokenCount: 99 },
          },
        ]).replace(/\n/g, "\r\n"),
        17,
      ),
      sseResponse(sse([{ candidates: [{ content: { role: "model", parts: [{ text: "Both added." }] }, finishReason: "STOP" }] }])),
    );
    const user: AiChatMessage = { role: "user", content: "Add the vendor and staffing risks." };
    const first = await collect(streamProvider(geminiCall([user])));
    expect(first).toEqual([
      { t: "text", d: "Adding " },
      { t: "text", d: "two risks." },
      { t: "tool_use", id: "fc-a", name: "add_risk", input: RISK_A, signature: "c2lnLWE=" },
      { t: "tool_use", id: "fc-b", name: "add_risk", input: RISK_B },
      { t: "stop", reason: "tool_use" },
    ]);
    expect(http.url(0)).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse");
    expect(http.headers(0)["x-goog-api-key"]).toBe("test-key");
    const req = http.body(0) as { tools: { functionDeclarations: Record<string, unknown>[] }[]; systemInstruction: unknown };
    expect(req.systemInstruction).toEqual({ parts: [{ text: "You are Keel's assistant." }] });
    const [addRisk, updateIssue] = req.tools[0].functionDeclarations;
    // Full JSON Schema as written: type arrays, additionalProperties, minimum and maximum.
    expect(addRisk).toEqual({ name: "add_risk", description: tool("add_risk").description, parametersJsonSchema: tool("add_risk").input_schema });
    expect(addRisk).not.toHaveProperty("parameters");
    // A nullable enum becomes enum-or-null, since Gemini's enum lists strings.
    const statusEnum = (tool("update_issue").input_schema.properties.status as { enum: (string | null)[] }).enum;
    expect(statusEnum).toContain(null);
    expect((updateIssue.parametersJsonSchema as { properties: Record<string, unknown> }).properties.status).toEqual({
      anyOf: [{ type: "string", enum: statusEnum.filter((v) => v !== null) }, { type: "null" }],
    });

    const results: AiChatMessage = {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "fc-a", content: "Added R-1." },
        { type: "tool_result", tool_use_id: "fc-b", content: "Project not found.", is_error: true },
      ],
    };
    const second = await collect(streamProvider(geminiCall([user, assistantTurn(first), results])));
    expect(second).toEqual([
      { t: "text", d: "Both added." },
      { t: "stop", reason: "end_turn" },
    ]);
    expect(http.body(1).contents).toEqual([
      { role: "user", parts: [{ text: "Add the vendor and staffing risks." }] },
      {
        role: "model",
        parts: [
          { text: "Adding two risks." },
          { functionCall: { name: "add_risk", args: RISK_A, id: "fc-a" }, thoughtSignature: "c2lnLWE=" },
          { functionCall: { name: "add_risk", args: RISK_B, id: "fc-b" } },
        ],
      },
      {
        role: "user",
        parts: [
          { functionResponse: { name: "add_risk", response: { result: "Added R-1." }, id: "fc-a" } },
          { functionResponse: { name: "add_risk", response: { error: "Project not found." }, id: "fc-b" } },
        ],
      },
    ]);
  });

  it("gives calls from another provider the documented placeholder on the first call only, and keeps synthetic ids off the wire", async () => {
    mockFetch(sseResponse(sse([{ candidates: [{ content: { parts: [{ functionCall: { name: "add_risk", args: RISK_A } }] }, finishReason: "STOP" }] }])));
    const [ev] = await collect(streamProvider(geminiCall([{ role: "user", content: "x" }])));
    // Gemini sent no id: Keel fills one in, unique to the stream.
    expect(ev).toMatchObject({ t: "tool_use", name: "add_risk", id: expect.stringMatching(/^keel_call_\w+_1$/) });
    const synthetic = (ev as { id: string }).id;

    const history: AiChatMessage[] = [
      { role: "user", content: "x" },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "toolu_01", name: "add_risk", input: RISK_A },
          { type: "tool_use", id: synthetic, name: "add_risk", input: RISK_B },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_01", content: "ok" },
          { type: "tool_result", tool_use_id: synthetic, content: "ok" },
        ],
      },
    ];
    expect(toGeminiContents(history, "gemini-3.8-flash").slice(1)).toEqual([
      {
        role: "model",
        parts: [
          { functionCall: { name: "add_risk", args: RISK_A, id: "toolu_01" }, thoughtSignature: GEMINI_SKIP_SIGNATURE },
          { functionCall: { name: "add_risk", args: RISK_B } },
        ],
      },
      {
        role: "user",
        parts: [
          { functionResponse: { name: "add_risk", response: { result: "ok" }, id: "toolu_01" } },
          { functionResponse: { name: "add_risk", response: { result: "ok" } } },
        ],
      },
    ]);
    // Gemini 2.x never validated signatures, so it gets no placeholder.
    expect(toGeminiContents(history, "gemini-2.5-flash")[1].parts[0]).not.toHaveProperty("thoughtSignature");
  });

  it("reports malformed calls and missing signatures as errors, and blocked prompts as refusals", async () => {
    mockFetch(
      sseResponse(sse([{ candidates: [{ content: { parts: [] }, finishReason: "MALFORMED_FUNCTION_CALL", finishMessage: "Malformed function call: add_risk(" }] }])),
      sseResponse(sse([{ candidates: [{ finishReason: "MISSING_THOUGHT_SIGNATURE" }] }])),
      sseResponse(sse([{ promptFeedback: { blockReason: "SAFETY" } }])),
      sseResponse(sse([{ candidates: [{ content: { parts: [{ text: "Long…" }] }, finishReason: "MAX_TOKENS" }] }])),
    );
    const malformed = await collect(streamProvider(geminiCall([{ role: "user", content: "x" }])));
    expect(malformed).toEqual([
      { t: "error", message: "Gemini produced a tool call it could not complete. Try again, or ask more simply. (Malformed function call: add_risk()" },
      { t: "stop", reason: "end_turn" },
    ]);
    const missing = await collect(streamProvider(geminiCall([{ role: "user", content: "x" }])));
    expect(missing[0]).toMatchObject({ t: "error", message: expect.stringContaining("thought signature") });
    expect(await collect(streamProvider(geminiCall([{ role: "user", content: "x" }])))).toEqual([{ t: "stop", reason: "refusal" }]);
    expect((await collect(streamProvider(geminiCall([{ role: "user", content: "x" }])))).at(-1)).toEqual({ t: "stop", reason: "max_tokens" });
  });
});

// ----- shared plumbing ----------------------------------------------------------------

describe("errorFromHttp", () => {
  const res = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

  it("maps statuses to Keel's codes and keeps the provider's message", async () => {
    const unauthorized = await errorFromHttp(res(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), "Anthropic");
    expect(unauthorized).toMatchObject({ code: "bad_key", status: 401, message: "invalid x-api-key" });

    const geminiKey = await errorFromHttp(
      res(400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } }),
      "Google Gemini",
    );
    expect(geminiKey).toMatchObject({ code: "bad_key", status: 401, message: "API key not valid. Please pass a valid API key." });

    expect(await errorFromHttp(res(404, { error: { message: "The model `gpt-9` does not exist or you do not have access to it." } }), "OpenAI")).toMatchObject({
      code: "model_not_found",
      status: 404,
    });
    expect(await errorFromHttp(res(429, { error: { message: "Rate limit reached" } }), "Groq")).toMatchObject({ code: "rate_limited", status: 429 });
    expect(await errorFromHttp(res(400, { error: { message: "Invalid schema for function 'add_risk'." } }), "OpenAI")).toMatchObject({ code: "bad_request", status: 400 });
    expect(await errorFromHttp(res(529, { error: { message: "Overloaded" } }), "Anthropic")).toMatchObject({ code: "overloaded" });
    expect(await errorFromHttp(res(502, "<html>Bad gateway</html>"), "Ollama")).toMatchObject({ code: "server_error", status: 502, message: "<html>Bad gateway</html>" });
  });

  it("surfaces as a ProviderError before any event is streamed", async () => {
    mockFetch(res(404, { error: { message: "models/gemini-9 is not found" } }));
    const gen = streamProvider(call({ family: "gemini", provider: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-9" }));
    const err = await gen.next().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ code: "model_not_found", message: "models/gemini-9 is not found" });
  });
});

describe("sseData", () => {
  it("handles CRLF, comments, multi-line data, a CR/LF pair split across reads, and a final event with no blank line", async () => {
    const text = ": keep-alive\r\n\r\nevent: a\r\ndata: one\r\n\r\ndata: two\r\ndata: lines\r\n\r\n:another comment\r\nid: 7\r\ndata:no-space\r\n\r\ndata: last";
    const bytes = encoder.encode(text);
    const cut = text.indexOf("\r\n\r\ndata: two") + 1; // between \r and \n
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, cut));
        c.enqueue(bytes.slice(cut));
        c.close();
      },
    });
    const out: string[] = [];
    for await (const d of sseData(body)) out.push(d);
    expect(out).toEqual(["one", "two\nlines", "no-space", "last"]);
  });
});

describe("browser calls to this machine or the local network", () => {
  it("classifies hosts the way Local Network Access does", () => {
    expect(addressSpace("localhost")).toBe("loopback");
    expect(addressSpace("127.0.0.1")).toBe("loopback");
    expect(addressSpace("[::1]")).toBe("loopback");
    expect(addressSpace("[::ffff:7f00:1]")).toBe("loopback");
    expect(addressSpace("192.168.1.20")).toBe("local");
    expect(addressSpace("10.0.0.5")).toBe("local");
    expect(addressSpace("[fd12:3456::1]")).toBe("local");
    expect(addressSpace("printer.local")).toBe("local");
    expect(addressSpace("fdroid.org")).toBe("public");
    expect(addressSpace("fc.example.com")).toBe("public");
    expect(addressSpace("api.openai.com")).toBe("public");
  });

  it("tags only browser fetches to private hosts", () => {
    expect(localNetworkInit("http://localhost:11434/v1/chat/completions", true)).toEqual({ targetAddressSpace: "loopback" });
    expect(localNetworkInit("http://192.168.1.20:1234/v1/models", true)).toEqual({ targetAddressSpace: "local" });
    expect(localNetworkInit("https://api.anthropic.com/v1/messages", true)).toEqual({});
    expect(localNetworkInit("http://localhost:11434/v1/chat/completions", false)).toEqual({});
  });

  it("passes targetAddressSpace on a direct call to Ollama", async () => {
    const http = mockFetch(sseResponse(sse([{ choices: [{ delta: { content: "OK" }, finish_reason: "stop" }] }, "[DONE]"])));
    const events = await collect(
      streamProvider(call({ family: "openai", provider: "ollama", baseUrl: "http://localhost:11434/v1", apiKey: undefined, model: "llama3.1", browser: true })),
    );
    expect(events).toEqual([
      { t: "text", d: "OK" },
      { t: "stop", reason: "end_turn" },
    ]);
    expect(http.init(0).targetAddressSpace).toBe("loopback");
    expect(http.headers(0)).not.toHaveProperty("authorization");
  });
});
