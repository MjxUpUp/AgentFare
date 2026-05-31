import { describe, it, expect } from "vitest";
import { buildAnalyzerPrompt } from "../../src/analyzer/llm-analyzer.js";
import { extractTaskFromMessages } from "../../src/analyzer/types.js";

describe("extractTaskFromMessages", () => {
  it("should extract task from last user message", () => {
    const messages = [
      { role: "user" as const, content: "Design a new auth system with OAuth2" },
    ];
    const result = extractTaskFromMessages(messages);
    expect(result.task).toContain("auth system");
    expect(result.task).toContain("OAuth2");
  });

  it("should extract context from recent messages", () => {
    const messages = [
      { role: "user" as const, content: "read the file" },
      { role: "assistant" as const, content: "Here is the file content", tool_calls: [{ id: "1", type: "function" as const, function: { name: "read_file", arguments: '{"path":"test.ts"}' } }] },
      { role: "user" as const, content: "now fix the bug" },
    ];
    const result = extractTaskFromMessages(messages);
    expect(result.task).toBe("now fix the bug");
    expect(result.context).toContain("read_file");
  });

  it("should extract tool names from assistant messages", () => {
    const messages = [
      { role: "assistant" as const, content: "", tool_calls: [{ id: "1", type: "function" as const, function: { name: "read_file", arguments: "{}" } }] },
      { role: "user" as const, content: "do something" },
    ];
    const result = extractTaskFromMessages(messages);
    expect(result.tools).toContain("read_file");
  });
});

describe("buildAnalyzerPrompt", () => {
  it("should produce valid prompt with task and context", () => {
    const prompt = buildAnalyzerPrompt({
      task: "Design a new authentication system with OAuth2",
      context: "Working on a web application",
      tools: ["read_file", "write_file", "run_test"],
    });

    expect(prompt).toContain("authentication system");
    expect(prompt).toContain("read_file");
    expect(prompt).toContain("JSON");
  });
});
