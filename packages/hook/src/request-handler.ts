import type { ModelRegistry, ModelEntry } from "@agentfare/models";
import { getApiKeyForProvider } from "@agentfare/models";
import type { AgentFareConfig, StepAnalysis, RoutingDecision, Message } from "@agentfare/core";
import { analyzeStepRules, Router, RouteCache, analyzeWithLLM, selectAnalyzerModel } from "@agentfare/core";
import { estimateTokensFromMessages } from "@agentfare/core";

export interface HandleResult {
  decision: RoutingDecision;
  modifiedBody: string;
  analysis: StepAnalysis;
  sessionId: string;
}

// ISSUE-014: typed interfaces for L2/L3 injection
interface RouteCacheLike {
  get(key: string): StepAnalysis | null;
  set(key: string, analysis: StepAnalysis): void;
}

type LLMAnalyzerFn = (messages: Message[], fetchFn: typeof globalThis.fetch, url: string, modelId: string, apiKey: string) => Promise<StepAnalysis | null>;

type SelectAnalyzerModelFn = (registry: ModelRegistry) => ModelEntry | null;

export class RequestHandler {
  private router: Router;
  private cache: RouteCacheLike | null = null;
  private llmAnalyzer: LLMAnalyzerFn | null = null;
  private selectAnalyzerModelFn: SelectAnalyzerModelFn | null = null;
  private getOriginalFetchFn: (() => typeof globalThis.fetch) | null = null;

  constructor(
    private config: AgentFareConfig,
    private registry: ModelRegistry,
  ) {
    this.router = new Router(config, registry);
  }

  /** Task 12-13 call this to inject L2/L3 capabilities */
  injectL2L3(deps: {
    cache: RouteCacheLike;
    analyzeWithLLM: LLMAnalyzerFn;
    selectAnalyzerModel: SelectAnalyzerModelFn;
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
      const cacheKey = RouteCache.makeKey(taskText);
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
      // ISSUE-027: use shared estimateTokensFromMessages (via import from @agentfare/core)
      const fallbackTokens = estimateTokensFromMessages(messages);
      analysis = {
        stepType: "unknown",
        difficulty: 0.5,
        confidence: 0.3,
        recommendedTier: "standard",
        recommendedModel: "",
        reasoning: "L1 未匹配，L2 不可用或低置信度，保守使用 standard tier",
        needsProviderSwitch: false,
        estimatedTokens: fallbackTokens,
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
      const cacheKey = RouteCache.makeKey(taskText, analysis.stepType);
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

// ISSUE-015: use shared ENV_KEY_MAP from @agentfare/models
function getEnvKeyForProvider(provider: string): string | undefined {
  return getApiKeyForProvider(provider);
}
