import { describe, expect, it } from "vitest";
import { chunkText, dot } from "../ai/embeddings";

describe("chunkText", () => {
  it("returns one chunk for short text and overlapping windows for long text", () => {
    expect(chunkText("hello")).toEqual(["hello"]);
    expect(chunkText("   ")).toEqual([]);
    const long = Array.from({ length: 40 }, (_, i) => `Line ${i} ${"x".repeat(60)}`).join("\n");
    const chunks = chunkText(long, 500, 100, 8);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThanOrEqual(8);
    expect(chunks.every((c) => c.length <= 500)).toBe(true);
  });
});

describe("dot", () => {
  it("is the cosine of normalised vectors", () => {
    expect(dot(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBe(1);
    expect(dot(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBe(0);
  });
});
