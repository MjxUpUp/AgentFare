import type { StepAnalysis, LLMAnalysisInput, Message } from "./types.js";
import { extractTaskFromMessages } from "./types.js";
import { estimateTokensFromMessages } from "../utils/tokens.js";

export function buildAnalyzerPrompt(input: LLMAnalysisInput): string {
  return `你是一个 AI Agent 步骤分析器。根据以下信息判断这个步骤的难度和推荐模型等级。

任务: ${input.task}
对话上下文: ${input.context ?? "无"}
可用工具: ${input.tools?.join(", ") ?? "无"}

输出 JSON:
{
  "stepType": "planning|exploration|editing|testing|reviewing|reasoning|formatting|simple_tool_use|confirmation",
  "difficulty": 0.0-1.0,
  "recommendedTier": "fast|standard|powerful",
  "confidence": 0.0-1.0,
  "reasoning": "一句话解释"
}

判断标准:
- fast: 格式化、简单搜索、文件读取、确认操作、样板代码生成
- standard: 常规代码编写、标准重构、测试编写、中等复杂度的 bug 修复
- powerful: 架构设计、复杂多文件调试、安全审计、需要深度推理的问题

只输出 JSON，不要其他内容。`;
}

export async function analyzeWithLLM(
  messages: Message[],
  fetchFn: typeof globalThis.fetch,
  analyzerModelUrl: string,
  analyzerModelId: string,
  apiKey: string,
): Promise<StepAnalysis | null> {
  const input = extractTaskFromMessages(messages);
  const prompt = buildAnalyzerPrompt(input);

  try {
    const response = await fetchFn(analyzerModelUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "x-agentfare-internal": "true",
      },
      body: JSON.stringify({
        model: analyzerModelId,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0,
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const json = JSON.parse(extractJSON(content));

    const estimatedTokens = estimateTokensFromMessages(messages);
    const validTiers = ["fast", "standard", "powerful"] as const;
    const recommendedTier = validTiers.includes(json.recommendedTier) ? json.recommendedTier : "standard";
    const alternatives = buildAlternatives(recommendedTier);

    return {
      stepType: json.stepType ?? "unknown",
      difficulty: clamp(json.difficulty, 0, 1),
      confidence: clamp(json.confidence, 0, 1),
      recommendedTier,
      // ISSUE-029: parse recommendedModel from LLM output when present
      recommendedModel: typeof json.recommendedModel === "string" && json.recommendedModel ? json.recommendedModel : "",
      reasoning: json.reasoning ?? "",
      needsProviderSwitch: false,
      estimatedTokens,
      alternatives,
    };
  } catch (err) {
    console.warn("[agentfare] LLM analyzer failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

function extractJSON(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : "{}";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildAlternatives(recommendedTier: string): StepAnalysis["alternatives"] {
  const tiers: Array<{ tier: "fast" | "standard" | "powerful"; costSavingsVsRecommended: number; qualityRisk: "none" | "low" | "medium" | "high" }> = [];
  if (recommendedTier === "fast") {
    tiers.push({ tier: "standard", costSavingsVsRecommended: -0.5, qualityRisk: "none" });
    tiers.push({ tier: "powerful", costSavingsVsRecommended: -2.0, qualityRisk: "none" });
  } else if (recommendedTier === "standard") {
    tiers.push({ tier: "fast", costSavingsVsRecommended: 0.6, qualityRisk: "medium" });
    tiers.push({ tier: "powerful", costSavingsVsRecommended: -1.5, qualityRisk: "none" });
  } else {
    tiers.push({ tier: "standard", costSavingsVsRecommended: 1.5, qualityRisk: "low" });
    tiers.push({ tier: "fast", costSavingsVsRecommended: 2.0, qualityRisk: "high" });
  }
  return tiers.map((t) => ({ model: "", tier: t.tier, costSavingsVsRecommended: t.costSavingsVsRecommended, qualityRisk: t.qualityRisk }));
}


