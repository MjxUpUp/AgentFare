import type { ModelEntry } from "./types.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { getRemoteModelCachePath } from "./paths.js";

const REMOTE_URL = "https://raw.githubusercontent.com/agentfare/models/main/models.json";

export async function fetchRemoteModels(): Promise<ModelEntry[]> {
  try {
    const response = await fetch(REMOTE_URL, { signal: AbortSignal.timeout(5000) } as RequestInit);
    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data)) return [];
    return validateModelEntries(data);
  } catch {
    return [];
  }
}

export function mergeRemoteModels(builtin: ModelEntry[], remote: ModelEntry[]): ModelEntry[] {
  const map = new Map<string, ModelEntry>();
  for (const m of builtin) map.set(m.id, m);
  for (const m of remote) map.set(m.id, m); // remote overrides builtin
  return Array.from(map.values());
}

export function saveRemoteModels(models: ModelEntry[]): void {
  try {
    const dir = path.dirname(getRemoteModelCachePath());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getRemoteModelCachePath(), JSON.stringify(models));
  } catch (err) {
    process.stderr.write(`[agentfare] remote model cache write failed: ${err instanceof Error ? err.message : err}\n`);
  }
}

export function loadCachedRemoteModels(): ModelEntry[] {
  try {
    if (!fs.existsSync(getRemoteModelCachePath())) return [];
    const data = JSON.parse(fs.readFileSync(getRemoteModelCachePath(), "utf-8"));
    return validateModelEntries(data);
  } catch { return []; }
}

export function validateModelEntries(data: unknown): ModelEntry[] {
  if (!Array.isArray(data)) return [];
  const valid: ModelEntry[] = [];
  for (let i = 0; i < data.length; i++) {
    const entry = data[i] as any;
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.id !== "string" || !entry.id) continue;
    if (typeof entry.provider !== "string" || !entry.provider) continue;
    if (typeof entry.displayName !== "string") continue;
    if (!["fast", "standard", "powerful"].includes(entry.tier)) continue;
    if (
      !entry.pricing ||
      typeof entry.pricing.inputPerMillion !== "number" ||
      entry.pricing.inputPerMillion < 0 ||
      typeof entry.pricing.outputPerMillion !== "number" ||
      entry.pricing.outputPerMillion < 0
    ) continue;
    if (
      !entry.api ||
      typeof entry.api.baseUrl !== "string" ||
      !entry.api.baseUrl ||
      typeof entry.api.modelId !== "string" ||
      !entry.api.modelId ||
      !["openai", "anthropic"].includes(entry.api?.protocol)
    ) continue;
    // Fill defaults for optional fields
    if (!entry.capabilities) {
      entry.capabilities = { codeGeneration: 5, codeReview: 5, planning: 5, reasoning: 5, toolUse: 5, contextWindow: 32, maxOutputTokens: 4, streaming: true, jsonMode: false };
    }
    if (!entry.routing) {
      entry.routing = { avgLatencyMs: 1000, tokensPerSecond: 50, availability: 0.99, region: ["global"] };
    }

    valid.push(entry as ModelEntry);
  }
  return valid;
}
