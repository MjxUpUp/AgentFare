import type { ModelRegistry, ModelEntry } from "@agentfare/models";
import type { AgentFareConfig, CrossProviderMode, EnterpriseProviderConfig } from "../config/types.js";
import type { StepAnalysis } from "../analyzer/types.js";
import { findSameProviderModel } from "./same-provider.js";
import { tryCrossProviderOptIn } from "./cross-provider.js";
import { tryCrossProviderEnterprise } from "./enterprise.js";

export interface RoutingDecision {
  targetModel: ModelEntry | null;
  providerSwitched: boolean;
  crossProviderMode: CrossProviderMode;
  apiKey?: string;
  enterpriseConfig?: EnterpriseProviderConfig;
  reasoning: string;
}

export class Router {
  constructor(
    private config: AgentFareConfig,
    private registry: ModelRegistry,
  ) {}

  decide(originalUrl: string, analysis: StepAnalysis): RoutingDecision {
    const originalProvider = this.registry.detectProvider(originalUrl);

    if (!originalProvider) {
      return {
        targetModel: null,
        providerSwitched: false,
        crossProviderMode: this.config.routing.crossProvider,
        reasoning: `无法识别 provider: ${originalUrl}`,
      };
    }

    const tier = analysis.recommendedTier;

    // If recommended model is already same provider
    if (analysis.recommendedModel) {
      const recommended = this.registry.get(analysis.recommendedModel);
      if (recommended && recommended.provider === originalProvider) {
        return {
          targetModel: recommended,
          providerSwitched: false,
          crossProviderMode: this.config.routing.crossProvider,
          reasoning: analysis.reasoning,
        };
      }
    }

    // Same provider routing
    const sameProviderModel = findSameProviderModel(
      this.registry,
      originalProvider,
      tier,
      this.config.routing.defaultStrategy,
    );

    if (!sameProviderModel) {
      return {
        targetModel: null,
        providerSwitched: false,
        crossProviderMode: this.config.routing.crossProvider,
        reasoning: `provider ${originalProvider} 无可用模型`,
      };
    }

    if (this.config.routing.crossProvider === "off") {
      return {
        targetModel: sameProviderModel,
        providerSwitched: false,
        crossProviderMode: "off",
        reasoning: `crossProvider=off, 降级到同 provider: ${analysis.reasoning}`,
      };
    }

    // Try cross-provider (ISSUE-029: try even without recommendedModel when analysis suggests cost savings)
    // First, try with explicit recommendedModel if available
    if (analysis.recommendedModel) {
      const recommended = this.registry.get(analysis.recommendedModel);
      if (recommended && recommended.provider !== originalProvider) {
        const crossResult = this.tryCrossProviderForProvider(recommended.provider, tier);
        if (crossResult) {
          return {
            targetModel: crossResult.model,
            providerSwitched: true,
            crossProviderMode: this.config.routing.crossProvider,
            apiKey: crossResult.apiKey,
            enterpriseConfig: crossResult.enterpriseConfig,
            reasoning: `跨 provider (recommended=${recommended.provider}): ${analysis.reasoning}`,
          };
        }
      }
    }

    // Fallback: try all configured cross-provider providers for a cheaper alternative
    if (sameProviderModel && this.config.routing.crossProvider === "opt-in") {
      for (const provider of this.config.routing.crossProviderProviders) {
        if (provider === originalProvider) continue;
        const crossResult = tryCrossProviderOptIn(
          this.registry, provider, tier, this.config.routing,
        );
        if (crossResult && crossResult.model.pricing.outputPerMillion < sameProviderModel.pricing.outputPerMillion) {
          return {
            targetModel: crossResult.model,
            providerSwitched: true,
            crossProviderMode: "opt-in",
            apiKey: crossResult.apiKey,
            reasoning: `跨 provider (cost-optimal): ${analysis.reasoning}`,
          };
        }
      }
    }

    if (this.config.routing.crossProvider === "enterprise") {
      for (const provider of this.config.routing.crossProviderProviders) {
        if (provider === originalProvider) continue;
        const crossResult = tryCrossProviderEnterprise(
          this.registry, provider, tier, this.config.routing,
        );
        if (crossResult && crossResult.model.pricing.outputPerMillion < sameProviderModel.pricing.outputPerMillion) {
          return {
            targetModel: crossResult.model,
            providerSwitched: true,
            crossProviderMode: "enterprise",
            enterpriseConfig: crossResult.config,
            reasoning: `跨 provider (enterprise): ${analysis.reasoning}`,
          };
        }
      }
    }

    return {
      targetModel: sameProviderModel,
      providerSwitched: false,
      crossProviderMode: this.config.routing.crossProvider,
      reasoning: analysis.reasoning,
    };
  }

  private tryCrossProviderForProvider(provider: string, tier: string): { model: ModelEntry; apiKey?: string; enterpriseConfig?: EnterpriseProviderConfig } | null {
    if (this.config.routing.crossProvider === "opt-in") {
      return tryCrossProviderOptIn(this.registry, provider, tier as any, this.config.routing);
    }
    if (this.config.routing.crossProvider === "enterprise") {
      const result = tryCrossProviderEnterprise(this.registry, provider, tier as any, this.config.routing);
      return result ? { model: result.model, enterpriseConfig: result.config } : null;
    }
    return null;
  }
}

