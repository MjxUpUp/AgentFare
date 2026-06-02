import type { ModelRegistry } from "@agentfare/models";

// LLM API path suffixes — universal across all providers
const LLM_PATH_PATTERNS = [
  /\/chat\/completions/,    // OpenAI protocol
  /\/v1\/messages/,         // Anthropic protocol
];

/**
 * Build a set of known LLM provider hosts from the model registry.
 * This replaces the old hardcoded URL patterns — any provider registered
 * in the registry is automatically recognized, including custom models.
 */
export class LLMDetector {
  private knownHosts: Set<string>;

  constructor(registry: ModelRegistry) {
    this.knownHosts = new Set<string>();
    for (const model of registry.getAll()) {
      try {
        const host = new URL(model.api.baseUrl).host;
        this.knownHosts.add(host);
      } catch {}
    }
  }

  isLLMApiCall(url: string): boolean {
    try {
      const host = new URL(url).host;
      if (!this.knownHosts.has(host)) return false;
      return LLM_PATH_PATTERNS.some((p) => p.test(url));
    } catch {
      return false;
    }
  }
}
