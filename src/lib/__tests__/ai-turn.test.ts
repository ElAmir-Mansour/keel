import { describe, expect, it } from "vitest";
import { TurnAccumulator } from "../ai/turn";
import { withCitations } from "../ai/citations";

describe("TurnAccumulator", () => {
  it("assembles text, tool calls and thinking from NDJSON, across chunk boundaries", () => {
    const acc = new TurnAccumulator();
    const lines = [
      JSON.stringify({ t: "thinking", thinking: "", signature: "sig" }),
      JSON.stringify({ t: "text", d: "I will " }),
      JSON.stringify({ t: "text", d: "create them." }),
      JSON.stringify({ t: "tool_use", id: "tu_1", name: "create_issues", input: { projectKey: null, issues: [{ title: "A" }] } }),
      JSON.stringify({ t: "stop", reason: "tool_use" }),
    ].join("\n");
    // Split mid-line to prove buffering works.
    acc.feed(lines.slice(0, 40));
    acc.feed(lines.slice(40));
    const r = acc.finish();
    expect(r.text).toBe("I will create them.");
    expect(r.stopReason).toBe("tool_use");
    expect(r.toolCalls).toEqual([{ id: "tu_1", name: "create_issues", input: { projectKey: null, issues: [{ title: "A" }] } }]);
    expect(r.blocks.map((b) => b.type)).toEqual(["thinking", "text", "tool_use"]);
  });

  it("drops malformed lines and records stream errors", () => {
    const acc = new TurnAccumulator();
    acc.feed('not json\n{"t":"error","message":"boom"}\n{"t":"text","d":"ok"}\n');
    const r = acc.finish();
    expect(r.text).toBe("ok");
    expect(acc.error).toBe("boom");
  });

  it("calls handlers as events arrive", () => {
    const seen: string[] = [];
    const acc = new TurnAccumulator({ onText: (d) => seen.push(d), onToolCall: (c) => seen.push(c.name) });
    acc.feed('{"t":"text","d":"hi"}\n{"t":"tool_use","id":"x","name":"log_decision","input":{}}\n');
    expect(seen).toEqual(["hi", "log_decision"]);
  });
});

describe("withCitations", () => {
  it("links known citation numbers and leaves the rest", () => {
    const out = withCitations("Reviews queue [2] and see [9]. Not a cite [x](y).", [
      { n: 1, kind: "Note", title: "A", link: "A" },
      { n: 2, kind: "Issue", title: "B", link: "PLAT-12" },
    ]);
    expect(out).toBe("Reviews queue [2](wiki:PLAT-12) and see [9]. Not a cite [x](y).");
  });
});
