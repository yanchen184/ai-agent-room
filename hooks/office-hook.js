#!/usr/bin/env node
// Claude Code hook：把 hook stdin JSON 精簡成一行事件，append 到事件檔。
// 任何錯誤都吞掉並 exit 0 —— hook 絕不能擋住 Claude Code 本體。

import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_EVENTS_FILE = join(homedir(), '.claude', 'office', 'events.jsonl');

const TEXT_LIMIT = 200;

function clip(value) {
  if (typeof value !== 'string') return undefined;
  return value.length > TEXT_LIMIT ? value.slice(0, TEXT_LIMIT) : value;
}

export function toEventLine(raw, now = Date.now()) {
  const input = JSON.parse(raw);
  const event = {
    ts: now,
    hook_event_name: input.hook_event_name,
    session_id: input.session_id,
    cwd: input.cwd,
  };
  if (input.tool_name) event.tool_name = input.tool_name;
  const prompt = clip(input.prompt);
  if (prompt) event.prompt = prompt;
  const message = clip(input.message);
  if (message) event.message = message;
  return JSON.stringify(event);
}

function main() {
  let raw = '';
  process.stdin.on('data', (chunk) => {
    raw += chunk;
  });
  process.stdin.on('end', () => {
    try {
      const file = process.env.CLAUDE_OFFICE_EVENTS || DEFAULT_EVENTS_FILE;
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `${toEventLine(raw)}\n`);
    } catch {
      // 靜默：事件掉了沒關係，Claude Code 不能被 hook 弄掛。
    }
    process.exit(0);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
