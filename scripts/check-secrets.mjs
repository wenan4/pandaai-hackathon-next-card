#!/usr/bin/env node
// 密钥扫描。
//   node scripts/check-secrets.mjs dist   扫描构建产物：关键字 + .env 里的真实值 + JWT
//   node scripts/check-secrets.mjs        扫描所有 git 跟踪的文件：.env 里的真实值 + JWT
// 发现问题时非零退出。只输出文件名和命中类型，不输出命中内容。
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.argv[2];
const root = fileURLToPath(new URL("..", import.meta.url));

// 只在构建产物里查关键字：仓库文档里讨论 token / password 是正常的
const KEYWORDS = [/PANDA_/, /DEFAULT_PASSWORD/, /password/i, /\btoken\b/i];
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;

function envSecrets() {
  const values = [];
  for (const name of [".env", ".env.local"]) {
    const p = join(root, name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const value = m[2].replace(/^["']|["']$/g, "");
      if (value.length >= 6) values.push({ key: m[1], value });
    }
  }
  return values;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

let files;
let keywordScan;
if (target) {
  const dir = join(root, target);
  if (!existsSync(dir)) {
    console.error(`check-secrets: ${target} 不存在`);
    process.exit(1);
  }
  files = walk(dir);
  keywordScan = true;
} else {
  files = execSync("git ls-files -co --exclude-standard", { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .map((f) => join(root, f));
  keywordScan = false;
}

const secrets = envSecrets();
const problems = [];
for (const file of files) {
  if (!existsSync(file)) continue;
  const text = readFileSync(file, "latin1");
  const rel = file.slice(root.length);
  for (const { key, value } of secrets) {
    if (text.includes(value)) problems.push(`${rel}: 含有 .env 中 ${key} 的值`);
  }
  if (JWT.test(text)) problems.push(`${rel}: 疑似 JWT token`);
  if (keywordScan) {
    for (const re of KEYWORDS) {
      if (re.test(text)) problems.push(`${rel}: 命中关键字 ${re}`);
    }
  }
}

if (problems.length) {
  console.error("check-secrets: 发现疑似密钥\n" + problems.map((p) => "  " + p).join("\n"));
  process.exit(1);
}
console.log(`check-secrets: ${files.length} 个文件通过（${target ?? "git 跟踪文件"}）`);
