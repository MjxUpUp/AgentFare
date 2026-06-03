import type { StepAnalysis, StepAnalysisRequest, Message } from "./types.js";
import { estimateTokensFromMessages } from "../utils/tokens.js";

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

const PLANNING_PATTERNS = [
  /\b(plan|roadmap|strategy|approach|break\s+down|step[\s-]by[\s-]step|how\s+should\s+we|what's\s+the\s+plan)\b.*\b(project|feature|task|migration|refactor)\b/i,
  /\b(create|write|draft)\s+(a\s+)?(plan|roadmap|strategy|design\s+doc|spec)\b/i,
  /\b(before\s+we\s+start|let's\s+plan|plan\s+out|think\s+through)\b/i,
];

const TESTING_PATTERNS = [
  /\b(write|add|create|run|generate)\s+.*(test|spec|snapshot|e2e|integration\s+test)\b/i,
  /\b(test|spec|jest|mocha|vitest|pytest|unittest)\s+(for|of|that|it|case|suite)\b/i,
  /\b(unit\s+test|integration\s+test|e2e\s+test|test\s+coverage|regression\s+test)\b/i,
  /\b(assert|expect|should|verify|validate)\s+.*\b(works?|returns?|throws?|matches?)\b/i,
];

const REVIEWING_PATTERNS = [
  /\b(review|audit|inspect|check|analyze)\s+.*\b(code|pr|pull\s+request|changes?|diff|commit)\b/i,
  /\b(code\s+review|pr\s+review|security\s+review|look\s+over)\b/i,
  /\b(any\s+issues?|anything\s+wrong|any\s+bugs?|spot\s+(any|the))\s+.*\b(problem|issue|bug|error)\b/i,
  /\b(what\s+do\s+you\s+think|looks?\s+(good|correct|right)|feedback)\b.*\b(code|changes?|implementation)\b/i,
];

const REASONING_PATTERNS = [
  /\b(why|explain|reason|analyze|compare|evaluate|assess|weigh)\b.*\b(approach|option|alternative|solution|performance|architecture|design|pattern|decision|trade[\s-]?off|pros?\s+and\s+cons?|advantage|disadvantage|better|worse|best)\b/i,
  /\b(how\s+does|what\s+(is|are)\s+the\s+difference|which\s+(is|approach|method)\s+(is\s+)?(better|best|worse))\b/i,
  /\b(trade[\s-]?off|pros?\s+and\s+cons?|advantage|disadvantage|justify|rationale)\b.*\b(option|approach|alternative|solution|design|pattern|decision|choice)\b/i,
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

  // ISSUE-027: use shared estimateTokensFromMessages from utils/tokens.ts
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

  // Rule: planning
  if (isMatch(userText, PLANNING_PATTERNS)) {
    return {
      stepType: "planning",
      difficulty: 0.6,
      confidence: 0.8,
      recommendedTier: "powerful",
      recommendedModel: "",
      reasoning: "规划/设计任务，需要高推理能力",
      needsProviderSwitch: false,
      estimatedTokens,
      alternatives: [
        {
          model: "",
          tier: "standard",
          costSavingsVsRecommended: 0.4,
          qualityRisk: "medium",
        },
      ],
    };
  }

  // Rule: testing
  if (isMatch(userText, TESTING_PATTERNS)) {
    return {
      stepType: "testing",
      difficulty: 0.4,
      confidence: 0.8,
      recommendedTier: "standard",
      recommendedModel: "",
      reasoning: "测试编写/运行任务",
      needsProviderSwitch: false,
      estimatedTokens,
      alternatives: [
        {
          model: "",
          tier: "fast",
          costSavingsVsRecommended: 0.5,
          qualityRisk: "low",
        },
        {
          model: "",
          tier: "powerful",
          costSavingsVsRecommended: -1.0,
          qualityRisk: "none",
        },
      ],
    };
  }

  // Rule: reviewing
  if (isMatch(userText, REVIEWING_PATTERNS)) {
    return {
      stepType: "reviewing",
      difficulty: 0.5,
      confidence: 0.8,
      recommendedTier: "powerful",
      recommendedModel: "",
      reasoning: "代码审查/分析任务，需要高准确性",
      needsProviderSwitch: false,
      estimatedTokens,
      alternatives: [
        {
          model: "",
          tier: "standard",
          costSavingsVsRecommended: 0.3,
          qualityRisk: "medium",
        },
      ],
    };
  }

  // Rule: reasoning (complex analysis, comparisons, trade-offs)
  if (isMatch(userText, REASONING_PATTERNS)) {
    return {
      stepType: "reasoning",
      difficulty: 0.6,
      confidence: 0.75,
      recommendedTier: "powerful",
      recommendedModel: "",
      reasoning: "推理/分析任务，需要深度理解",
      needsProviderSwitch: false,
      estimatedTokens,
      alternatives: [
        {
          model: "",
          tier: "standard",
          costSavingsVsRecommended: 0.3,
          qualityRisk: "medium",
        },
      ],
    };
  }

  return null;
}

function isMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}
