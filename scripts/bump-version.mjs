#!/usr/bin/env node
// 统一 bump 所有 packages/*/package.json 的 version 字段。
// 内部 @agentfare/* 依赖用 workspace:*，发布时 pnpm 自动替换为真实版本，无需改动。
//
// 用法: VERSION=0.2.0 pnpm version:bump
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const version = process.env.VERSION;
if (!version) {
  console.error("用法: VERSION=0.2.0 pnpm version:bump");
  process.exit(1);
}

const pkgsDir = join(process.cwd(), "packages");
let count = 0;
for (const dir of readdirSync(pkgsDir)) {
  const file = join(pkgsDir, dir, "package.json");
  if (!existsSync(file)) continue;
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  const old = pkg.version;
  pkg.version = version;
  writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`  ${dir}: ${old} -> ${version}`);
  count++;
}

console.log(`\n已 bump ${count} 个包到 ${version}`);
console.log(
  `下一步: git add -A && git commit -m "chore: v${version}" && git tag v${version} && git push --tags`,
);
