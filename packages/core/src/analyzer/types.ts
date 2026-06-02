import type { ModelTier } from "@agentfare/models";

export type StepType =
  | "planning"
  | "exploration"
  | "editing"
  | "testing"
  | "reviewing"
  | "reasoning"
  | "formatting"
  | "simple_tool_use"
  | "confirmation"
  | "unknown";

export interface StepAnalysis {
  stepType: StepType;
  difficulty: number; // 0-1
  confidence: number; // 0-1
  recommendedTier: ModelTier;
  recommendedModel: string;
  reasoning: string;
  needsProviderSwitch: boolean;
  estimatedTokens: { input: number; output: number };
  alternatives: Array<{
    model: string;
    tier: ModelTier;
    costSavingsVsRecommended: number;
    qualityRisk: "none" | "low" | "medium" | "high";
  }>;
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentBlock[];
  tool_calls?: ToolCall[];
}

export interface ContentBlock {
  type: string;
  text?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface StepAnalysisRequest {
  messages: Message[];
  originalModel: string;
  availableTools?: string[];
  previousModel?: string;
}

export interface LLMAnalysisInput {
  task: string;
  context?: string;
  tools?: string[];
  previousModel?: string;
}

export function extractTaskFromMessages(messages: Message[]): LLMAnalysisInput {
  const userMessages = messages.filter((m) => m.role === "user");
  const lastUserMsg = userMessages.at(-1);
  const task = lastUserMsg
    ? typeof lastUserMsg.content === "string"
      ? lastUserMsg.content
      : lastUserMsg.content
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join(" ")
    : "";

  const recentMessages = messages.slice(-6, -1);
  const context = recentMessages
    .map((m) => {
      const text = typeof m.content === "string" ? m.content : "";
      const tools =
        m.tool_calls
          ?.map((tc) => `${tc.function.name}(${tc.function.arguments})`)
          .join(", ") ?? "";
      return `[${m.role}] ${text}${tools ? ` (tools: ${tools})` : ""}`;
    })
    .join("\n")
    .slice(0, 2000);

  const tools = messages
    .filter((m) => m.role === "assistant" && m.tool_calls)
    .flatMap((m) => m.tool_calls!.map((tc) => tc.function.name));

  return {
    task: task.slice(0, 2000),
    context: context || undefined,
    tools: tools.length > 0 ? tools : undefined,
  };
}
