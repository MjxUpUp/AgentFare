import type { ModelEntry, ModelTier } from "./types.js";
import { BUILTIN_MODELS } from "./builtin-models.js";

export class ModelRegistry {
  private models: Map<string, ModelEntry> = new Map();

  constructor(customModels: ModelEntry[] = []) {
    for (const model of BUILTIN_MODELS) {
      this.models.set(model.id, model);
    }
    for (const model of customModels) {
      this.models.set(model.id, model);
    }
  }

  get(id: string): ModelEntry | undefined {
    return this.models.get(id);
  }

  getAll(): ModelEntry[] {
    return Array.from(this.models.values());
  }

  getByProvider(provider: string): ModelEntry[] {
    return this.getAll().filter((m) => m.provider === provider);
  }

  getByTier(tier: ModelTier): ModelEntry[] {
    return this.getAll().filter((m) => m.tier === tier);
  }

  findCheapest(provider: string, tier: ModelTier): ModelEntry | undefined {
    const candidates = this.getByProvider(provider).filter((m) => m.tier === tier);
    if (candidates.length === 0) return undefined;
    return candidates.reduce((cheapest, m) =>
      m.pricing.outputPerMillion < cheapest.pricing.outputPerMillion ? m : cheapest
    );
  }

  /**
   * Detect the provider from a URL by matching its host against all registered
   * models' api.baseUrl hosts. No hardcoded patterns — any provider added to the
   * registry (builtin or custom) is automatically recognized.
   */
  detectProvider(url: string): string | null {
    try {
      const host = new URL(url).host;
      for (const model of this.models.values()) {
        try {
          if (new URL(model.api.baseUrl).host === host) {
            return model.provider;
          }
        } catch {}
      }
    } catch {}
    return null;
  }

  addCustomModel(model: ModelEntry): void {
    this.models.set(model.id, model);
  }
}
