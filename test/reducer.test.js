import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState,
  reduce,
  parseEventLine,
  deriveAgents,
  STATUS,
} from '../src/reducer.js';

const T0 = 1_700_000_000_000;

function ev(hookEventName, overrides = {}) {
  return {
    ts: T0,
    hook_event_name: hookEventName,
    session_id: 'sess-1',
    cwd: '/Users/yanchen/workspace/wez-rag',
    ...overrides,
  };
}

test('SessionStart 建立 agent，名稱取 cwd basename，狀態 idle', () => {
  const state = reduce(emptyState(), ev('SessionStart'));
  const agent = state.agents['sess-1'];
  assert.ok(agent);
  assert.equal(agent.name, 'wez-rag');
  assert.equal(agent.status, STATUS.IDLE);
  assert.equal(agent.deskIndex, 0);
});

test('UserPromptSubmit 轉 working', () => {
  let state = reduce(emptyState(), ev('SessionStart'));
  state = reduce(state, ev('UserPromptSubmit', { ts: T0 + 1000, prompt: '修 bug' }));
  assert.equal(state.agents['sess-1'].status, STATUS.WORKING);
});

test('PreToolUse 記錄目前工具且維持 working', () => {
  let state = reduce(emptyState(), ev('SessionStart'));
  state = reduce(state, ev('PreToolUse', { ts: T0 + 1000, tool_name: 'Bash' }));
  const agent = state.agents['sess-1'];
  assert.equal(agent.status, STATUS.WORKING);
  assert.equal(agent.currentTool, 'Bash');
});

test('Notification 轉 waiting（等使用者批准）', () => {
  let state = reduce(emptyState(), ev('SessionStart'));
  state = reduce(state, ev('PreToolUse', { ts: T0 + 1000, tool_name: 'Bash' }));
  state = reduce(state, ev('Notification', { ts: T0 + 2000, message: 'needs permission' }));
  assert.equal(state.agents['sess-1'].status, STATUS.WAITING);
});

test('Stop 轉 idle 並清掉 currentTool', () => {
  let state = reduce(emptyState(), ev('SessionStart'));
  state = reduce(state, ev('PreToolUse', { ts: T0 + 1000, tool_name: 'Edit' }));
  state = reduce(state, ev('Stop', { ts: T0 + 2000 }));
  const agent = state.agents['sess-1'];
  assert.equal(agent.status, STATUS.IDLE);
  assert.equal(agent.currentTool, null);
});

test('SessionEnd 轉 offline 並釋出座位', () => {
  let state = reduce(emptyState(), ev('SessionStart'));
  state = reduce(state, ev('SessionEnd', { ts: T0 + 1000 }));
  assert.equal(state.agents['sess-1'].status, STATUS.OFFLINE);
  const s2 = reduce(state, ev('SessionStart', { ts: T0 + 2000, session_id: 'sess-2' }));
  assert.equal(s2.agents['sess-2'].deskIndex, 0);
});

test('沒 SessionStart 先來 PreToolUse 也會自動建 agent（容錯）', () => {
  const state = reduce(emptyState(), ev('PreToolUse', { tool_name: 'Read' }));
  const agent = state.agents['sess-1'];
  assert.ok(agent);
  assert.equal(agent.status, STATUS.WORKING);
});

test('座位依序分配且各 agent 不同座位', () => {
  let state = emptyState();
  for (let i = 0; i < 3; i++) {
    state = reduce(state, ev('SessionStart', { session_id: `s${i}`, ts: T0 + i }));
  }
  const desks = Object.values(state.agents).map((a) => a.deskIndex);
  assert.deepEqual([...desks].sort(), [0, 1, 2]);
});

test('第 7 位之後 deskIndex 為 null（辦公室只有 6 個工位）', () => {
  let state = emptyState();
  for (let i = 0; i < 7; i++) {
    state = reduce(state, ev('SessionStart', { session_id: `s${i}`, ts: T0 + i }));
  }
  assert.equal(state.agents['s6'].deskIndex, null);
});

test('reduce 不可變：不改動原 state', () => {
  const before = reduce(emptyState(), ev('SessionStart'));
  const frozen = JSON.stringify(before);
  reduce(before, ev('PreToolUse', { ts: T0 + 1000, tool_name: 'Bash' }));
  assert.equal(JSON.stringify(before), frozen);
});

test('parseEventLine 解析合法 JSON、拒絕爛行', () => {
  assert.equal(parseEventLine('not json{{{'), null);
  assert.equal(parseEventLine(''), null);
  const parsed = parseEventLine(JSON.stringify(ev('Stop')));
  assert.equal(parsed.hook_event_name, 'Stop');
});

test('deriveAgents：working 超過 10 分鐘沒動靜降為 sleeping', () => {
  let state = reduce(emptyState(), ev('SessionStart'));
  state = reduce(state, ev('UserPromptSubmit', { ts: T0 + 1000 }));
  const now = T0 + 1000 + 11 * 60 * 1000;
  const agents = deriveAgents(state, now);
  assert.equal(agents[0].status, STATUS.SLEEPING);
});

test('deriveAgents：offline 超過 30 分鐘就從清單移除', () => {
  let state = reduce(emptyState(), ev('SessionStart'));
  state = reduce(state, ev('SessionEnd', { ts: T0 + 1000 }));
  const soon = deriveAgents(state, T0 + 2000);
  assert.equal(soon.length, 1);
  const later = deriveAgents(state, T0 + 1000 + 31 * 60 * 1000);
  assert.equal(later.length, 0);
});

test('deriveAgents：同名專案 basename 撞名時補上層目錄後綴，分得清', () => {
  let state = emptyState();
  state = reduce(state, ev('SessionStart', {
    session_id: 'sA', ts: T0, cwd: '/Users/yanchen/client-a/api',
  }));
  state = reduce(state, ev('SessionStart', {
    session_id: 'sB', ts: T0 + 1, cwd: '/Users/yanchen/client-b/api',
  }));
  const names = deriveAgents(state, T0 + 2).map((a) => a.name).sort();
  assert.deepEqual(names, ['api (client-a)', 'api (client-b)']);
});

test('deriveAgents：不撞名時名稱維持原樣（畫面零變動）', () => {
  let state = emptyState();
  state = reduce(state, ev('SessionStart', {
    session_id: 'sA', ts: T0, cwd: '/Users/yanchen/workspace/wez-rag',
  }));
  state = reduce(state, ev('SessionStart', {
    session_id: 'sB', ts: T0 + 1, cwd: '/Users/yanchen/workspace/boardgame',
  }));
  const names = deriveAgents(state, T0 + 2).map((a) => a.name).sort();
  assert.deepEqual(names, ['boardgame', 'wez-rag']);
});

test('deriveAgents：撞名但無上層目錄可用時退回 session 短碼', () => {
  let state = emptyState();
  state = reduce(state, ev('SessionStart', { session_id: 'aaaa-1', ts: T0, cwd: '/api' }));
  state = reduce(state, ev('SessionStart', { session_id: 'bbbb-2', ts: T0 + 1, cwd: '/api' }));
  const names = deriveAgents(state, T0 + 2).map((a) => a.name).sort();
  assert.deepEqual(names, ['api (aaaa)', 'api (bbbb)']);
});

test('活動 feed 記錄事件、上限 50 筆、最新在前', () => {
  let state = emptyState();
  for (let i = 0; i < 60; i++) {
    state = reduce(state, ev('PreToolUse', { ts: T0 + i, tool_name: `Tool${i}` }));
  }
  assert.equal(state.feed.length, 50);
  assert.equal(state.feed[0].ts, T0 + 59);
});
