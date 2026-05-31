import type { ModelEntry, ModelTier } from "./types.js";
import { BUILTIN_MODELS } from "./builtin-models.js";

const URL_PROVIDER_PATTERNS: Array<{ pattern: RegExp; provider: string }> = [
  { pattern: /api\.openai\.com/, provider: "openai" },
  { pattern: /api\.anthropic\.com/, provider: "anthropic" },
  { pattern: /generativelanguage\.googleapis/, provider: "google" },
  { pattern: /api\.deepseek\.com/, provider: "deepseek" },
  { pattern: /open\.bigmodel\.cn/, provider: "zhipu" },
  { pattern: /api\.moonshot\.cn/, provider: "moonshot" },
  { pattern: /dashscope\.aliyuncs/, provider: "alibaba" },
  { pattern: /platform\.xiaomimimo\.com/, provider: "xiaomi" },
];

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

  detectProvider(url: string): string | null {
    for (const { pattern, provider } of URL_PROVIDER_PATTERNS) {
      if (pattern.test(url)) return provider;
    }
    return null;
  }

  addCustomModel(model: ModelEntry): void {
    this.models.set(model.id, model);
  }
}
