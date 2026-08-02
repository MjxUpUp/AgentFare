/**
 * @agentfare/proxy — Daemon entry point.
 *
 * This file is run as a detached child process by `startProxyDaemon()`.
 * It initializes all dependencies, starts the proxy server, and keeps
 * running until signaled to stop.
 *
 * cc-switch 支持：维护一个可变的依赖容器（handler/registry/providerMap）。
 * admin POST /api/active → applyLock → reloadConfig 在运行时替换这些依赖，
 * 使 GUI 一键切换模型后下一个请求即按新锁定路由，无需重启 daemon。DB 和
 * costTracker 不随热加载重建（同一 SQLite 文件，复用连接）。
 *
 * Usage: node dist/daemon-entry.js --port <port>
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfigFromDisk, TrackingDatabase, CostTracker, QualitySignalCollector, setLogger, atomicWriteFileSync } from "@agentfare/core";
import { ModelRegistry, getDbPath, DEFAULT_PROXY_PORT, getConfigPath } from "@agentfare/models";
import { RequestHandler } from "@agentfare/hook/request-handler";
import { startProxy, readProxyState } from "./lifecycle.js";
import { buildProviderMap } from "./provider-map.js";
import type { ActiveLock } from "./admin.js";
import { buildLockedConfigJson } from "./lock-config.js";
import { buildProvidersConfigJson } from "./config-patch.js";
import { saveKeys as persistKeys } from "./credential-store.js";
import type { ProviderConfig } from "@agentfare/core";

// Daemon owns the process — enable stderr logging (stdout may be piped to log file)
setLogger({
  info(message: string) { process.stdout.write(`${message}\n`); },
  warn(message: string) { process.stderr.write(`${message}\n`); },
  error(message: string) { process.stderr.write(`${message}\n`); },
});

// Parse --port from argv
function parsePort(): number {
  const portArg = process.argv.find((a, i) => process.argv[i - 1] === "--port");
  const port = portArg ? parseInt(portArg, 10) : DEFAULT_PROXY_PORT;
  if (isNaN(port) || port < 1 || port > 65535) {
    process.stderr.write(`Invalid port: ${portArg}\n`);
    process.exit(1);
  }
  return port;
}

async function main(): Promise<void> {
  const port = parsePort();

  // Admin token：复用旧 proxy.json 的 token（若有），否则生成新的。复用保证
  // daemon 重启后 GUI 缓存的 token 仍有效，避免每次重启都要重新 bootstrap。
  const existingState = readProxyState();
  const adminToken = existingState?.adminToken ?? randomUUID();

  // 持久化的 DB / tracker 不随配置热加载重建（同一 SQLite 文件，复用连接）。
  const dbPath = getDbPath();
  const db = new TrackingDatabase(dbPath);
  const costTracker = new CostTracker(db);
  const qualitySignalCollector = new QualitySignalCollector();

  // 可变依赖容器：reloadConfig 替换 handler/registry/providerMap 属性，server 经
  // options.deps 引用读到最新值（server.ts handleRequest 每次读 options.deps.*）。
  // 原子性来自 reloadConfig 是全同步块 ⇒ JS 事件循环 run-to-completion ⇒ 正在
  // 处理的请求读到 old 或 new 的一致快照，不会读到半更新的 deps。这套"sync-only =
  // 原子"不变式依赖 reloadConfig 全程同步——未来若改成 async 文件 IO（fs/promises）
  // 会破坏原子性，届时需加串行化 mutex。sync-only invariant — async here breaks
  // the atomic swap (also M1).
  let currentConfig = loadConfigFromDisk();
  const deps = {
    handler: new RequestHandler(currentConfig, new ModelRegistry(currentConfig.customModels)),
    registry: new ModelRegistry(currentConfig.customModels),
    providerMap: buildProviderMap(currentConfig),
    costTracker,
    qualitySignalCollector,
    db,
    getRouting: () => currentConfig.routing,
    applyLock: (lock: ActiveLock): { ok: true } | { ok: false; error: string } => {
      try {
        const configPath = getConfigPath();
        const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf-8") : null;
        // 纯函数：把 lock 合并进 routing（保留其余字段），corrupt config 拒绝写（H2，
        // 不再 partial={} 吞掉 providers/customModels）。清残留 / 保留非 routing 字段
        // 的不变式由 lock-config.test.ts 覆盖，这里只做 IO + reload。
        const built = buildLockedConfigJson(existing, lock);
        if (!built.ok) return { ok: false, error: built.error };
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        // M4: 写前备份上一个 config，坏写可回滚；仅在覆盖既有文件时。
        if (existing !== null) {
          fs.copyFileSync(configPath, configPath + ".bak");
        }
        atomicWriteFileSync(configPath, built.content);
        reloadConfig();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    // POST /api/keys（A2）：credential-store.saveKeys 合并写 keys.json + 权限加固
    // + 失效缓存。key-store.resolveApiKey 三层读含 loadKeysFromDisk（mtime 缓存），
    // 失效后下一请求即读新 key，无需 reloadConfig。alias persistKeys 避免与本
    // 属性名同名混淆。
    saveKeys: (updates: Record<string, string>): void => {
      persistKeys(updates);
    },
    // POST /api/providers（A3）：buildProvidersConfigJson patch providers 段（保留
    // 其余字段，corrupt 拒写）→ .bak 备份 → 原子写 → reloadConfig 重建 providerMap。
    // 与 applyLock 同结构（M4 备份 + sync-only 原子交换不变式）。
    applyProviders: (
      update: Record<string, ProviderConfig>,
    ): { ok: true } | { ok: false; error: string } => {
      try {
        const configPath = getConfigPath();
        const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf-8") : null;
        const built = buildProvidersConfigJson(existing, update);
        if (!built.ok) return { ok: false, error: built.error };
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        if (existing !== null) {
          fs.copyFileSync(configPath, configPath + ".bak");
        }
        atomicWriteFileSync(configPath, built.content);
        reloadConfig();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };

  /** 重新从磁盘加载 config 并重建可路由依赖（handler/registry/providerMap）。 */
  function reloadConfig(): void {
    currentConfig = loadConfigFromDisk();
    const registry = new ModelRegistry(currentConfig.customModels);
    deps.handler = new RequestHandler(currentConfig, registry);
    deps.registry = registry;
    deps.providerMap = buildProviderMap(currentConfig);
  }

  process.on("exit", () => { try { db.close(); } catch {} });
  process.on("SIGTERM", () => { try { db.close(); } catch {}; process.exit(0); });
  process.on("SIGINT", () => { try { db.close(); } catch {}; process.exit(0); });

  const result = await startProxy({
    port,
    deps,
    adminToken,
  });

  if (!result.success) {
    process.stderr.write(`Failed to start proxy daemon: ${result.error}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Daemon error: ${err}\n`);
  process.exit(1);
});
