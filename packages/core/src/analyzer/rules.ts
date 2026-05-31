import type { StepAnalysis, StepAnalysisRequest, Message } from "./types.js";

const SIMPLE_TOOL_PATTERNS = [
  /\b(list|ls|cat|head|tail|find|grep|glob|which|where|pwd)\b/i,
  /\bread.file\b/i,
  /\bread_dir\b/i,
  /\bsearch.files\b/i,
];

const FORMATTING_PATTERNS = [
  /\bformat\b.*\bcode\b/i,
  /\blint\b.*\bfix\b/i,
  /\bprettier\b/i,
  /\beslint\b.*--fix/i,
  /\borganize\s+imports\b/i,
];

const CONFIRMATION_PATTERNS = [
  /^(yes|no|ok|okay|sure|proceed|continue|go ahead|y|n)\b/i,
  /^\b(confirm|cancel|apply|reject)\b/i,
];

const FILE_READ_TOOLS = [
  "read_file",
  "read_file_content",
  "get_file",
  "view_file",
  "search_files",
];

const EDIT_PATTERNS = [
  /\b(fix|update|change|modify|rename|refactor|implement|add)\b.*\b(in|the|a|this)\b.*\b(file|function|method|class|variable|module)\b/i,
  /\bwrite\s+(to|file|the)\b/i,
  /\bcreate\s+(a\s+)?(new\s+)?(file|component|module|class)\b/i,
];

const COMPLEX_KEYWORDS = [
  /\b(architect|design|redesign|overhaul|security\s+audit|performance\s+tuning)\b/i,
  /\b(multi[\s-]file|cross[\s-]module|system[\s-]wide|end[\s-]to[\s-]end)\b/i,
];

export function analyzeStepRules(request: StepAnalysisRequest): StepAnalysis | null {
  const { messages } = request;
  const lastUserMsg =
    messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
  const userText =
    typeof lastUserMsg === "string"
      ? lastUserMsg
      : lastUserMsg.map((b) => b.text ?? "").join(" ");
  const toolResults = messages.filter((m) => m.role === "tool");
  const hasToolCalls = messages.some(
    (m) => m.role === "assistant" && m.tool_calls?.length,
  );

  const hasImageContent = messages.some((m) => {
    if (typeof m.content !== "string" && Array.isArray(m.content)) {
      return (m.content as Array<{ type: string }>).some(
        (b) => b.type === "image" || b.type === "image_url",
      );
    }
    return false;
  });

  const estimatedTokens = estimateTokensFromMessages(messages);

  // Rule: confirmation
  if (isMatch(userText, CONFIRMATION_PATTERNS)) {
    return {
      stepType: "confirmation",
      difficulty: 0.1,
      confidence: 0.95,
      recommendedTier: "fast",
      recommendedModel: "",
      reasoning: "用户确认操作",
      needsProviderSwitch: false,
      estimatedTokens,
      alternatives: [
        {
          model: "",
          tier: "standard",
          costSavingsVsRecommended: -0.5,
          qualityRisk: "none",
        },
      ],
    };
  }

  // Rule: formatting/lint
  if (isMatch(userText, FORMATTING_PATTERNS)) {
    return {
      stepType: "formatting",
      difficulty: 0.15,
      confidence: 0.9,
      recommendedTier: "fast",
      recommendedModel: "",
      reasoning: "格式化/lint 修复",
      needsProviderSwitch: false,
      estimatedTokens,
      alternatives: [
        {
          model: "",
          tier: "standard",
          costSavingsVsRecommended: -0.3,
          qualityRisk: "none",
        },
      ],
    };
  }

  // Rule: simple tool use
  if (isMatch(userText, SIMPLE_TOOL_PATTERNS)) {
    return {
      stepType: "simple_tool_use",
      difficulty: 0.1,
      confidence: 0.9,
      recommendedTier: "fast",
      recommendedModel: "",
      reasoning: "简单工具调用",
      needsProviderSwitch: false,
      estimatedTokens,
      alternatives: [
        {
          model: "",
          tier: "standard",
          costSavingsVsRecommended: -0.4,
          qualityRisk: "none",
        },
      ],
    };
  }

  // Rule: non-complex code editing -> standard tier
  if (isMatch(userText, EDIT_PATTERNS) && !isMatch(userText, COMPLEX_KEYWORDS)) {
    return {
      stepType: "editing",
      difficulty: 0.4,
      confidence: 0.75,
      recommendedTier: "standard",
      recommendedModel: "",
      reasoning: "非复杂代码编辑",
      needsProviderSwitch: false,
      estimatedTokens,
      alternatives: [
        {
          model: "",
          tier: "fast",
          costSavingsVsRecommended: 0.6,
          qualityRisk: "medium",
        },
        {
          model: "",
          tier: "powerful",
          costSavingsVsRecommended: -2.0,
          qualityRisk: "none",
        },
      ],
    };
  }

  // Rule: file read tool calls
  if (hasToolCalls) {
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.tool_calls?.length);
    const toolNames =
      lastAssistant?.tool_calls?.map((tc) => tc.function.name) ?? [];
    if (toolNames.some((name) => FILE_READ_TOOLS.includes(name))) {
      return {
        stepType: "exploration",
        difficulty: 0.2,
        confidence: 0.85,
        recommendedTier: "fast",
        recommendedModel: "",
        reasoning: "文件读取/搜索操作",
        needsProviderSwitch: false,
        estimatedTokens,
        alternatives: [
          {
            model: "",
            tier: "standard",
            costSavingsVsRecommended: -0.3,
            qualityRisk: "none",
          },
        ],
      };
    }
  }

  // Rule: tool results from file reads
  if (toolResults.length > 0 && !hasToolCalls) {
    const resultContent = toolResults
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("");
    if (resultContent.length > 0) {
      return {
        stepType: "exploration",
        difficulty: 0.2,
        confidence: 0.7,
        recommendedTier: "fast",
        recommendedModel: "",
        reasoning: "文件读取结果",
        needsProviderSwitch: false,
        estimatedTokens,
        alternatives: [
          {
            model: "",
            tier: "standard",
            costSavingsVsRecommended: -0.3,
            qualityRisk: "none",
          },
        ],
      };
    }
  }

  // Multimodal: skip content analysis, use conservative strategy
  if (hasImageContent) {
    return {
      stepType: "unknown",
      difficulty: 0.5,
      confidence: 0.3,
      recommendedTier: "standard",
      recommendedModel: "",
      reasoning: "多模态内容，跳过内容分析",
      needsProviderSwitch: false,
      estimatedTokens,
      alternatives: [
        {
          model: "",
          tier: "powerful",
          costSavingsVsRecommended: -1.5,
          qualityRisk: "low",
        },
      ],
    };
  }

  return null;
}

function estimateTokensFromMessages(messages: Message[]): {
  input: number;
  output: number;
} {
  let totalChars = 0;
  for (const m of messages) {
    if (typeof m.content === "string") {
      totalChars += m.content.length;
    } else if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.text) totalChars += block.text.length;
      }
    }
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        totalChars += tc.function.arguments.length;
      }
    }
  }
  const inputTokens = Math.ceil(totalChars / 4);
  const outputTokens = Math.ceil(inputTokens * 0.3);
  return { input: inputTokens, output: outputTokens };
}

function isMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}
