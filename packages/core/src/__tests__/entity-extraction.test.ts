import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mockCreate,
    };
  },
}));

import { extractEntity } from "../entity-extraction.js";

function mockResponse(data: Record<string, unknown>) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: "text", text: JSON.stringify(data) }],
  });
}

describe("extractEntity", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("correctly classifies a person memory", async () => {
    mockResponse({
      entity_type: "person",
      entity_name: "Sarah Chen",
      structured_data: { name: "Sarah Chen", role: "Engineering Manager" },
      suggested_connections: [],
    });

    const result = await extractEntity("Sarah Chen is my engineering manager", null);
    expect(result.entity_type).toBe("person");
    expect(result.entity_name).toBe("Sarah Chen");
    expect(result.structured_data).toEqual({ name: "Sarah Chen", role: "Engineering Manager" });
  });

  it("correctly classifies a preference memory", async () => {
    mockResponse({
      entity_type: "preference",
      entity_name: null,
      structured_data: { category: "coding", strength: "strong" },
      suggested_connections: [],
    });

    const result = await extractEntity("I prefer TypeScript over JavaScript", null);
    expect(result.entity_type).toBe("preference");
    expect(result.structured_data.category).toBe("coding");
  });

  it("extracts entity_name from content", async () => {
    mockResponse({
      entity_type: "organization",
      entity_name: "Acme Corp",
      structured_data: { name: "Acme Corp", type: "company" },
      suggested_connections: [],
    });

    const result = await extractEntity("Acme Corp is a B2B SaaS company", null);
    expect(result.entity_name).toBe("Acme Corp");
  });

  it("returns suggested connections", async () => {
    mockResponse({
      entity_type: "person",
      entity_name: "Alice",
      structured_data: {},
      suggested_connections: [
        { target_entity_name: "Acme Corp", target_entity_type: "organization", relationship: "works_at" },
      ],
    });

    const result = await extractEntity("Alice works at Acme Corp", null);
    expect(result.suggested_connections).toHaveLength(1);
    expect(result.suggested_connections[0].relationship).toBe("works_at");
  });

  it("passes existing entity names to the prompt", async () => {
    mockResponse({
      entity_type: "person",
      entity_name: "Sarah Chen",
      structured_data: {},
      suggested_connections: [],
    });

    await extractEntity("Sarah is my manager", null, ["Sarah Chen", "Acme Corp"]);

    const callArgs = mockCreate.mock.calls[0][0];
    const prompt = callArgs.messages[0].content;
    expect(prompt).toContain("Sarah Chen");
    expect(prompt).toContain("Acme Corp");
  });

  it("handles API failure gracefully", async () => {
    mockCreate.mockRejectedValueOnce(new Error("API error"));

    await expect(extractEntity("test content", null)).rejects.toThrow("API error");
  });

  it("handles malformed JSON response", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "not valid json" }],
    });

    await expect(extractEntity("test content", null)).rejects.toThrow();
  });
});
