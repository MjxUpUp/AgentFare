import type { StepAnalysis } from "./types.js";
import { log } from "../utils/logger.js";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const CACHE_FILE = path.join(os.homedir(), ".agentfare", "cache", "route-cache.json");

export class RouteCache {
  private cache: Map<string, { analysis: StepAnalysis; timestamp: number }> = new Map();
  private ttlMs: number = 24 * 60 * 60 * 1000;
  private dirty: boolean = false;

  constructor(private maxSize: number = 1000) {
    this.loadFromDisk();
    // ISSUE-039: persist cache on process exit
    process.on("exit", () => this.saveToDisk());
  }

  static makeKey(task: string, stepType?: string): string {
    return crypto.createHash("sha256").update(`${task}::${stepType ?? ""}`).digest("hex").slice(0, 16);
  }

  get(key: string): StepAnalysis | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    return entry.analysis;
  }

  set(key: string, analysis: StepAnalysis): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, { analysis, timestamp: Date.now() });
    this.dirty = true;
  }

  clear(): void {
    this.cache.clear();
    this.dirty = true;
    this.saveToDisk();
  }

  invalidateOnPricingChange(): void {
    this.cache.clear();
    this.dirty = true;
    this.saveToDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const data = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")) as Array<[string, { analysis: StepAnalysis; timestamp: number }]>;
        for (const [key, value] of data) {
          if (Date.now() - value.timestamp <= this.ttlMs) {
            this.cache.set(key, value);
          }
        }
      }
    } catch (err) {
      log().warn(`[agentfare] Failed to load route cache from disk: ${err instanceof Error ? err.message : err}`);
    }
  }

  saveToDisk(): void {
    if (!this.dirty) return;
    try {
      const dir = path.dirname(CACHE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data = Array.from(this.cache.entries());
      fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
      this.dirty = false;
    } catch (err) {
      log().warn(`[agentfare] Failed to save route cache to disk: ${err instanceof Error ? err.message : err}`);
    }
  }
}
