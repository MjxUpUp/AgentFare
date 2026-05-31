import type { ModelEntry } from "./types.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const REMOTE_URL = "https://raw.githubusercontent.com/agentdispatch/models/main/models.json";
const CACHE_PATH = path.join(os.homedir(), ".agentdispatch", "cache", "remote-models.json");

export async function fetchRemoteModels(): Promise<ModelEntry[]> {
  try {
    const response = await fetch(REMOTE_URL, { signal: AbortSignal.timeout(5000) } as RequestInit);
    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data)) return [];
    return data as ModelEntry[];
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
    const dir = path.dirname(CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(models));
  } catch {}
}

export function loadCachedRemoteModels(): ModelEntry[] {
  try {
    if (!fs.existsSync(CACHE_PATH)) return [];
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
  } catch { return []; }
}
