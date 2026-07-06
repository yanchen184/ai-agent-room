import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toEventLine } from '../hooks/office-hook.js';

const HOOK = new URL('../hooks/office-hook.js', import.meta.url).pathname;

test('toEventLine 精簡欄位並截斷長 prompt', () => {
  const raw = JSON.stringify({
    hook_event_name: 'UserPromptSubmit',
    session_id: 's1',
    cwd: '/tmp/proj',
    prompt: 'x'.repeat(500),
    transcript_path: '/should/be/dropped',
  });
  const line = JSON.parse(toEventLine(raw, 123));
  assert.equal(line.ts, 123);
  assert.equal(line.hook_event_name, 'UserPromptSubmit');
  assert.equal(line.prompt.length, 200);
  assert.equal(line.transcript_path, undefined);
});

test('hook 端到端：餵 stdin 真實格式，事件檔多一行合法 JSON，exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'office-'));
  const eventsFile = join(dir, 'events.jsonl');
  const stdin = JSON.stringify({
    session_id: 'sess-e2e',
    transcript_path: '/x/y.jsonl',
    cwd: '/Users/yanchen/workspace/demo-proj',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
  });
  execFileSync('node', [HOOK], {
    input: stdin,
    env: { ...process.env, CLAUDE_OFFICE_EVENTS: eventsFile },
  });
  const lines = readFileSync(eventsFile, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const event = JSON.parse(lines[0]);
  assert.equal(event.session_id, 'sess-e2e');
  assert.equal(event.tool_name, 'Bash');
  assert.equal(event.tool_input, undefined);
});

test('hook 吃到爛 JSON 也 exit 0、不噴錯', () => {
  const dir = mkdtempSync(join(tmpdir(), 'office-'));
  execFileSync('node', [HOOK], {
    input: 'not-json{{{',
    env: { ...process.env, CLAUDE_OFFICE_EVENTS: join(dir, 'events.jsonl') },
  });
});
