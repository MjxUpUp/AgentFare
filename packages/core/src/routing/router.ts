import type { ModelRegistry, ModelEntry } from "@agentdispatch/models";
import type { AgentDispatchConfig, CrossProviderMode, EnterpriseProviderConfig } from "../config/types.js";
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
    private config: AgentDispatchConfig,
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

    // Try cross-provider
    if (analysis.recommendedModel) {
      const recommended = this.registry.get(analysis.recommendedModel);
      if (recommended && recommended.provider !== originalProvider) {
        if (this.config.routing.crossProvider === "opt-in") {
          const crossResult = tryCrossProviderOptIn(
            this.registry, recommended.provider, tier, this.config.routing,
          );
          if (crossResult) {
            return {
              targetModel: crossResult.model,
              providerSwitched: true,
              crossProviderMode: "opt-in",
              apiKey: crossResult.apiKey,
              reasoning: `跨 provider (opt-in): ${analysis.reasoning}`,
            };
          }
        }

        if (this.config.routing.crossProvider === "enterprise") {
          const crossResult = tryCrossProviderEnterprise(
            this.registry, recommended.provider, tier, this.config.routing,
          );
          if (crossResult) {
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
    }

    return {
      targetModel: sameProviderModel,
      providerSwitched: false,
      crossProviderMode: this.config.routing.crossProvider,
      reasoning: analysis.reasoning,
    };
  }
}
