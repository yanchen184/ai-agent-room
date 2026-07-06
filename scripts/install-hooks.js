#!/usr/bin/env node
// 一鍵把 Claude Code Office 的 hooks 裝進「目標專案」的 .claude/settings.json。
//
//   node scripts/install-hooks.js <目標專案絕對路徑>
//   node scripts/install-hooks.js .            # 裝進目前目錄的專案
//
// 特性：
// - hook command 用「本 repo 的絕對路徑」自動填好，買家不用手改。
// - 目標若已有 settings.json / 既有 hooks，安全合併：不覆蓋別的 hook，
//   只加入本產品這支 office-hook.js（已存在就跳過，可重跑不重複）。
// - 動目標檔前先備份成 settings.json.bak.<timestamp>。
// - 全程印出做了什麼 + 最後給一句 round-trip 驗證指示。

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK_PATH = join(REPO_ROOT, 'hooks', 'office-hook.js');
const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'Notification',
  'Stop',
  'SessionEnd',
];

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function officeHookCommand() {
  // 路徑含空白也安全：用雙引號包起來。
  return `node "${HOOK_PATH}"`;
}

// 這一格（單一 event）裡是否已經有本產品的 hook？用 office-hook.js 這個檔名判斷，
// 避免和買家自己的其他 hook 混淆，也讓重跑時 idempotent。
function alreadyInstalled(entries) {
  if (!Array.isArray(entries)) return false;
  return entries.some((group) =>
    Array.isArray(group?.hooks) &&
    group.hooks.some((h) => typeof h?.command === 'string' && h.command.includes('office-hook.js')),
  );
}

function officeHookGroup() {
  return { hooks: [{ type: 'command', command: officeHookCommand() }] };
}

function mergeHooks(settings) {
  const next = { ...settings, hooks: { ...(settings.hooks || {}) } };
  const summary = [];
  for (const eventName of HOOK_EVENTS) {
    const existing = Array.isArray(next.hooks[eventName]) ? next.hooks[eventName] : [];
    if (alreadyInstalled(existing)) {
      summary.push(`  = ${eventName}（已裝，跳過）`);
      continue;
    }
    next.hooks[eventName] = [...existing, officeHookGroup()];
    summary.push(existing.length
      ? `  + ${eventName}（併入既有 ${existing.length} 組 hook）`
      : `  + ${eventName}`);
  }
  return { next, summary };
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    fail('請給目標專案路徑：node scripts/install-hooks.js <目標專案絕對路徑>');
  }
  if (!existsSync(HOOK_PATH)) {
    fail(`找不到 hook 檔：${HOOK_PATH}（是不是 repo 結構被動過？）`);
  }

  const targetProject = isAbsolute(arg) ? arg : resolve(process.cwd(), arg);
  if (!existsSync(targetProject)) {
    fail(`目標專案不存在：${targetProject}`);
  }

  const claudeDir = join(targetProject, '.claude');
  const settingsPath = join(claudeDir, 'settings.json');
  mkdirSync(claudeDir, { recursive: true });

  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch (err) {
      fail(`目標 settings.json 不是合法 JSON，先修好再跑：${settingsPath}\n  ${err.message}`);
    }
    const backup = `${settingsPath}.bak.${Date.now()}`;
    copyFileSync(settingsPath, backup);
    console.log(`↩ 已備份既有設定：${backup}`);
  }

  const { next, summary } = mergeHooks(settings);
  writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`);

  console.log(`\n✓ hooks 已寫入：${settingsPath}`);
  console.log(`  hook 指令：${officeHookCommand()}`);
  console.log(summary.join('\n'));
  console.log('\n下一步（round-trip 驗證，別只信這行輸出）：');
  console.log(`  1. cd ${REPO_ROOT} && npm start   # 要接真實事件必須 npm start（demo 模式看不到真實 session）`);
  console.log(`  2. 在「${targetProject}」開一個 Claude Code session、送一則訊息`);
  console.log('  3. 打開 http://localhost:4680 —— 該專案的員工應該走進辦公室');
  console.log('     （沒出現就檢查：server 有沒有在跑、events.jsonl 有沒有新行）');
}

main();
