import { describe, it, expect } from "vitest";
import { parseLLMJson } from "../llm-utils.js";

describe("parseLLMJson", () => {
  it("parses plain JSON", () => {
    const result = parseLLMJson<{ name: string }>('{"name": "test"}');
    expect(result).toEqual({ name: "test" });
  });

  it("strips json code fences", () => {
    const result = parseLLMJson<{ a: number }>('```json\n{"a": 1}\n```');
    expect(result).toEqual({ a: 1 });
  });

  it("strips plain code fences", () => {
    const result = parseLLMJson<{ b: boolean }>('```\n{"b": true}\n```');
    expect(result).toEqual({ b: true });
  });

  it("handles whitespace around fences", () => {
    const result = parseLLMJson<number[]>('```json\n[1, 2, 3]\n```  ');
    expect(result).toEqual([1, 2, 3]);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseLLMJson("not json")).toThrow();
  });

  it("throws on empty string", () => {
    expect(() => parseLLMJson("")).toThrow();
  });
});
