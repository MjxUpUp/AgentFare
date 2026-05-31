import type { ModelRegistry } from "@agentdispatch/models";
import type { AgentDispatchConfig, StepAnalysis, RoutingDecision, Message } from "@agentdispatch/core";
import { analyzeStepRules, Router } from "@agentdispatch/core";

export interface HandleResult {
  decision: RoutingDecision;
  modifiedBody: string;
  analysis: StepAnalysis;
  sessionId: string;
}

export class RequestHandler {
  private router: Router;
  private cache: any | null = null;
  private llmAnalyzer: any | null = null;
  private selectAnalyzerModelFn: any | null = null;
  private getOriginalFetchFn: (() => typeof globalThis.fetch) | null = null;

  constructor(
    private config: AgentDispatchConfig,
    private registry: ModelRegistry,
  ) {
    this.router = new Router(config, registry);
  }

  /** Task 12-13 call this to inject L2/L3 capabilities */
  injectL2L3(deps: {
    cache: any;
    analyzeWithLLM: any;
    selectAnalyzerModel: any;
    getOriginalFetch: () => typeof globalThis.fetch;
  }): void {
    this.cache = deps.cache;
    this.llmAnalyzer = deps.analyzeWithLLM;
    this.selectAnalyzerModelFn = deps.selectAnalyzerModel;
    this.getOriginalFetchFn = deps.getOriginalFetch;
  }

  async handle(
    url: string,
    bodyStr: string,
    headers: Record<string, string>,
  ): Promise<HandleResult | null> {
    const body = JSON.parse(bodyStr);
    const messages: Message[] = body.messages ?? [];
    const originalModel = body.model;

    const lastUserMsg = messages.filter((m) => m.role === "user").at(-1);
    const taskText = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";

    // L1 rule matching
    let analysis = analyzeStepRules({
      messages,
      originalModel,
      availableTools: body.tools?.map((t: any) => t.function?.name).filter(Boolean),
    });

    // L3 cache (injected via injectL2L3)
    if (!analysis && this.cache && this.config.routing.cacheResults) {
      const cacheKey = (this.cache.constructor as any).makeKey(taskText);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        analysis = cached;
      }
    }

    // L2 LLM analysis (injected via injectL2L3)
    if (!analysis && this.llmAnalyzer && this.selectAnalyzerModelFn && this.getOriginalFetchFn) {
      if (this.config.routing.analyzerModel !== "off") {
        const analyzerModel = this.selectAnalyzerModelFn(this.registry);
        if (analyzerModel) {
          const fetchFn = this.getOriginalFetchFn();
          const analyzerUrl = analyzerModel.api.protocol === "anthropic"
            ? `${analyzerModel.api.baseUrl}/v1/messages`
            : `${analyzerModel.api.baseUrl}/chat/completions`;
          const analyzerKey = getEnvKeyForProvider(analyzerModel.provider);
          if (analyzerKey) {
            const llmAnalysis = await this.llmAnalyzer(
              messages, fetchFn, analyzerUrl, analyzerModel.api.modelId, analyzerKey,
            );
            if (llmAnalysis && llmAnalysis.confidence > 0.8) {
              analysis = llmAnalysis;
            }
          }
        }
      }
    }

    // L3 conservative fallback
    if (!analysis) {
      let totalChars = 0;
      for (const m of messages) {
        if (typeof m.content === "string") totalChars += m.content.length;
        else if (Array.isArray(m.content)) totalChars += m.content.filter((b: any) => b.type === "text").reduce((s: number, b: any) => s + (b.text?.length ?? 0), 0);
      }
      const inputTokens = Math.ceil(totalChars / 4);
      analysis = {
        stepType: "unknown",
        difficulty: 0.5,
        confidence: 0.3,
        recommendedTier: "standard",
        recommendedModel: "",
        reasoning: "L1 未匹配，L2 不可用或低置信度，保守使用 standard tier",
        needsProviderSwitch: false,
        estimatedTokens: { input: inputTokens, output: Math.ceil(inputTokens * 0.3) },
        alternatives: [
          { model: "", tier: "fast", costSavingsVsRecommended: 0.6, qualityRisk: "high" },
          { model: "", tier: "powerful", costSavingsVsRecommended: -1.5, qualityRisk: "none" },
        ],
      };
    }

    const decision = this.router.decide(url, analysis);

    if (decision.providerSwitched) {
      analysis.needsProviderSwitch = true;
    }

    if (!decision.targetModel) return null;
    if (decision.targetModel.api.modelId === originalModel && !decision.providerSwitched) {
      return null;
    }

    // Cache write (injected via injectL2L3)
    if (this.cache && this.config.routing.cacheResults && analysis.confidence > 0.7) {
      const cacheKey = (this.cache.constructor as any).makeKey(taskText, analysis.stepType);
      this.cache.set(cacheKey, analysis);
    }

    const modifiedBody = JSON.stringify({
      ...body,
      model: decision.targetModel.api.modelId,
    });

    const sessionId = headers["x-request-id"] ?? headers["x-session-id"] ?? generateSessionId();

    // Fill alternatives with real model IDs
    const filledAlternatives = analysis.alternatives.map((alt) => {
      if (alt.model) return alt;
      const candidates = this.registry.getByTier(alt.tier);
      const candidate = candidates.length > 0 ? candidates[0].id : "";
      return { ...alt, model: candidate };
    });

    return {
      decision,
      modifiedBody,
      analysis: {
        ...analysis,
        recommendedModel: decision.targetModel.id,
        alternatives: filledAlternatives,
      },
      sessionId,
    };
  }
}

let sessionCounter = 0;
function generateSessionId(): string {
  return `ad-${Date.now()}-${++sessionCounter}`;
}

const ENV_KEY_MAP: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  google: "GOOGLE_API_KEY",
  zhipu: "ZHIPU_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  alibaba: "ALIBABA_API_KEY",
  xiaomi: "XIAOMI_API_KEY",
};

function getEnvKeyForProvider(provider: string): string | undefined {
  const envKey = ENV_KEY_MAP[provider];
  return envKey ? process.env[envKey] : undefined;
}
