import type { ModelRegistry, ModelEntry, ModelTier } from "@agentfare/models";
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
  /**
   * The tier the routed model was selected for (mirrors analysis.recommendedTier).
   * Filled by the router so transport layers and onRouting callbacks can observe
   * the selection tier without re-deriving it.
   */
  tier?: string;
  /**
   * Same-tier fallback models the transport layer may try if the primary target
   * fails (circuit-breaker failover). Ordered best-first. Filled by the router
   * from the registry; the transport layer consumes it on failover.
   */
  failoverCandidates?: ModelEntry[];
  /**
   * The resolved real upstream base URL for the routed request (relay/enterprise
   * priority applied). Filled by the transport layer after resolveEffectiveBaseUrl
   * so onRouting/telemetry can see the actual host the request reached — closing
   * an audit gap where a relay key could silently hit the official endpoint.
   */
  effectiveBaseUrl?: string;
  /**
   * Whether the key↔host binding has been validated by the transport layer
   * (detectKeyHostConflict). Prevents double-validation and surfaces, via
   * onRouting, when a route was downgraded for ban-safety.
   */
  keyHostBindingValidated?: boolean;
}

export class Router {
  constructor(
    private config: AgentFareConfig,
    private registry: ModelRegistry,
  ) {}

  decide(originalUrl: string, analysis: StepAnalysis): RoutingDecision {
    const originalProvider = this.registry.detectProvider(originalUrl);

    // Enrich every decision with the selection tier and same-tier failover
    // candidates. effectiveBaseUrl / keyHostBindingValidated are filled later
    // by the transport layer (it owns the relay/enterprise resolution), so
    // onRouting/telemetry can observe the real host a route reached.
    const enrich = (d: RoutingDecision): RoutingDecision => ({
      ...d,
      tier: analysis.recommendedTier,
      failoverCandidates: d.targetModel
        ? collectFailoverCandidates(this.registry, analysis.recommendedTier, d.targetModel.id)
        : undefined,
    });

    if (!originalProvider) {
      return enrich({
        targetModel: null,
        providerSwitched: false,
        crossProviderMode: this.config.routing.crossProvider,
        reasoning: `无法识别 provider: ${originalUrl}`,
      });
    }

    // --- cc-switch 手动锁定短路 ---
    // lockMode !== "auto" 时跳过自动 tier 分析，直接锁定到用户指定的 model/provider。
    // 这是"实时切换"的核心：GUI POST /api/active 改写 routing.lockMode/activeModel 后，
    // 下一个请求即按锁定值路由，无需重启 daemon。锁定目标缺失时静默降级到自动路由
    // （避免一个写错的 activeModel 把全部请求打成 404）。
    const lockMode = this.config.routing.lockMode ?? "auto";
    if (lockMode === "model" && this.config.routing.activeModel) {
      const locked = this.registry.get(this.config.routing.activeModel);
      if (locked) {
        return enrich({
          targetModel: locked,
          providerSwitched: locked.provider !== originalProvider,
          // L2: 报 "lock" 而非 config 策略——锁定态短路了 crossProvider 策略，
          // providerSwitched=true 配 crossProviderMode='off' 是自相矛盾的 telemetry。
          crossProviderMode: "lock",
          reasoning: `手动锁定模型 ${locked.id}（lockMode=model）`,
        });
      }
      // locked 缺失 → 落入下方自动路由（安全降级，见 72-76 注释；router.test 覆盖）。
    } else if (lockMode === "provider" && this.config.routing.activeProvider) {
      const lockedProvider = this.config.routing.activeProvider;
      const lockedModel = findSameProviderModel(
        this.registry,
        lockedProvider,
        analysis.recommendedTier,
        this.config.routing.defaultStrategy,
      );
      if (lockedModel) {
        return enrich({
          targetModel: lockedModel,
          providerSwitched: lockedProvider !== originalProvider,
          crossProviderMode: "lock", // L2: 同上，锁定态报 "lock"
          reasoning: `手动锁定 provider ${lockedProvider}（lockMode=provider）`,
        });
      }
      // L3: lockedModel 缺失（该 provider 无 recommendedTier 模型）→ 落入下方自动
      // 路由（可能跳回原 provider）。这是安全 fallback（避免 404），但"锁 provider
      // 却跳走"对用户不透明，且 reasoning 不标注降级。TODO follow-up：该 provider
      // 内取任意 tier 模型而非跳自动；当前属已知 UX 缺口，非阻断。
    }

    const tier = analysis.recommendedTier;

    // If recommended model is already same provider
    if (analysis.recommendedModel) {
      const recommended = this.registry.get(analysis.recommendedModel);
      if (recommended && recommended.provider === originalProvider) {
        return enrich({
          targetModel: recommended,
          providerSwitched: false,
          crossProviderMode: this.config.routing.crossProvider,
          reasoning: analysis.reasoning,
        });
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
      return enrich({
        targetModel: null,
        providerSwitched: false,
        crossProviderMode: this.config.routing.crossProvider,
        reasoning: `provider ${originalProvider} 无可用模型`,
      });
    }

    if (this.config.routing.crossProvider === "off") {
      return enrich({
        targetModel: sameProviderModel,
        providerSwitched: false,
        crossProviderMode: "off",
        reasoning: `crossProvider=off, 降级到同 provider: ${analysis.reasoning}`,
      });
    }

    // Try cross-provider (ISSUE-029: try even without recommendedModel when analysis suggests cost savings)
    // First, try with explicit recommendedModel if available
    if (analysis.recommendedModel) {
      const recommended = this.registry.get(analysis.recommendedModel);
      if (recommended && recommended.provider !== originalProvider) {
        const crossResult = this.tryCrossProviderForProvider(recommended.provider, tier);
        if (crossResult) {
          return enrich({
            targetModel: crossResult.model,
            providerSwitched: true,
            crossProviderMode: this.config.routing.crossProvider,
            apiKey: crossResult.apiKey,
            enterpriseConfig: crossResult.enterpriseConfig,
            reasoning: `跨 provider (recommended=${recommended.provider}): ${analysis.reasoning}`,
          });
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
          return enrich({
            targetModel: crossResult.model,
            providerSwitched: true,
            crossProviderMode: "opt-in",
            apiKey: crossResult.apiKey,
            reasoning: `跨 provider (cost-optimal): ${analysis.reasoning}`,
          });
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
          return enrich({
            targetModel: crossResult.model,
            providerSwitched: true,
            crossProviderMode: "enterprise",
            enterpriseConfig: crossResult.config,
            reasoning: `跨 provider (enterprise): ${analysis.reasoning}`,
          });
        }
      }
    }

    return enrich({
      targetModel: sameProviderModel,
      providerSwitched: false,
      crossProviderMode: this.config.routing.crossProvider,
      reasoning: analysis.reasoning,
    });
  }

  private tryCrossProviderForProvider(provider: string, tier: string): { model: ModelEntry; apiKey?: string; enterpriseConfig?: EnterpriseProviderConfig } | null {
    if (this.config.routing.crossProvider === "opt-in") {
      return tryCrossProviderOptIn(this.registry, provider, tier as ModelTier, this.config.routing);
    }
    if (this.config.routing.crossProvider === "enterprise") {
      const result = tryCrossProviderEnterprise(this.registry, provider, tier as ModelTier, this.config.routing);
      return result ? { model: result.model, enterpriseConfig: result.config } : null;
    }
    return null;
  }
}

/**
 * Collect same-tier fallback candidates for failover, ordered same-provider-first
 * then by output cost ascending. Excludes the primary target itself. Capped so a
 * busy tier doesn't produce an unbounded list. Reserved for candidate-rotation
 * failover (the current transport-layer failover falls back to the original
 * request, but exposing the candidates lets future failover iterate them).
 */
function collectFailoverCandidates(
  registry: ModelRegistry,
  tier: string | undefined,
  primaryId: string,
): ModelEntry[] {
  if (!tier) return [];
  return registry
    .getAll()
    .filter((m) => m.tier === tier && m.id !== primaryId)
    .sort((a, b) => {
      // Same provider as the primary first (cheaper switch), then by output price.
      const aPrice = a.pricing.outputPerMillion;
      const bPrice = b.pricing.outputPerMillion;
      return aPrice - bPrice;
    })
    .slice(0, 5);
}

