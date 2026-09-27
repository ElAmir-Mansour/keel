import type { AiContentBlock, AiStreamEvent } from "./models";

// Assembles one assistant turn from the route's NDJSON events. Pure, so the
// wire format is unit-tested without a network.

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TurnResult {
  text: string;
  /** The assistant's content blocks in order, ready to echo back on the next request. */
  blocks: AiContentBlock[];
  toolCalls: ToolCall[];
  stopReason: string | null;
}

export class TurnAccumulator {
  readonly result: TurnResult = { text: "", blocks: [], toolCalls: [], stopReason: null };
  error: string | null = null;
  private textBlock: { type: "text"; text: string } | null = null;
  private pending = "";

  constructor(private handlers: { onText?: (delta: string) => void; onToolCall?: (call: ToolCall) => void } = {}) {}

  apply(ev: AiStreamEvent) {
    switch (ev.t) {
      case "text":
        this.result.text += ev.d;
        if (!this.textBlock) {
          this.textBlock = { type: "text", text: "" };
          this.result.blocks.push(this.textBlock);
        }
        this.textBlock.text += ev.d;
        this.handlers.onText?.(ev.d);
        break;
      case "tool_use": {
        this.textBlock = null;
        const call = { id: ev.id, name: ev.name, input: ev.input };
        this.result.toolCalls.push(call);
        this.result.blocks.push({ type: "tool_use", ...call });
        this.handlers.onToolCall?.(call);
        break;
      }
      case "thinking":
        this.textBlock = null;
        this.result.blocks.push({ type: "thinking", thinking: ev.thinking, signature: ev.signature });
        break;
      case "redacted_thinking":
        this.textBlock = null;
        this.result.blocks.push({ type: "redacted_thinking", data: ev.data });
        break;
      case "stop":
        this.result.stopReason = ev.reason;
        break;
      case "error":
        this.error = ev.message;
        break;
    }
  }

  /** Feed raw stream text; complete lines are parsed, the rest waits. */
  feed(chunk: string) {
    this.pending += chunk;
    let nl = this.pending.indexOf("\n");
    while (nl !== -1) {
      const line = this.pending.slice(0, nl).trim();
      this.pending = this.pending.slice(nl + 1);
      if (line) {
        try {
          this.apply(JSON.parse(line) as AiStreamEvent);
        } catch {
          // A malformed line is dropped rather than killing the turn.
        }
      }
      nl = this.pending.indexOf("\n");
    }
  }

  /** Flush a trailing line without a newline and drop empty text blocks. */
  finish(): TurnResult {
    if (this.pending.trim()) this.feed("\n");
    this.result.blocks = this.result.blocks.filter((b) => b.type !== "text" || b.text.length > 0);
    return this.result;
  }
}
