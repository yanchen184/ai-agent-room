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

test('SessionEnd 轉 offline；座位在 30 分鐘顯示窗內仍保留，超時才釋出', () => {
  let state = reduce(emptyState(), ev('SessionStart'));
  state = reduce(state, ev('SessionEnd', { ts: T0 + 1000 }));
  assert.equal(state.agents['sess-1'].status, STATUS.OFFLINE);
  // 窗內：下線者畫面上還看得到（顯示 30 分鐘），座位不能被搶走，否則會同桌重疊。
  // 只有 5 桌是唯一空位時新人才可能拿 desk 0；這裡 desk 0 仍被 offline 的 sess-1 佔著。
  const soon = reduce(state, ev('SessionStart', { ts: T0 + 2000, session_id: 'sess-2' }));
  assert.equal(soon.agents['sess-2'].deskIndex, 1);
  // 超時（>30 分鐘）：下線者從畫面消失，座位真正釋出，新人可拿回 desk 0。
  const later = reduce(state, ev('SessionStart', { ts: T0 + 1000 + 31 * 60 * 1000, session_id: 'sess-3' }));
  assert.equal(later.agents['sess-3'].deskIndex, 0);
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

test('候補中（deskIndex null）的 agent 在下線者座位真正釋出後（超過顯示窗）自動補位', () => {
  let state = emptyState();
  for (let i = 0; i < 7; i++) {
    state = reduce(state, ev('SessionStart', { session_id: `s${i}`, ts: T0 + i }));
  }
  assert.equal(state.agents['s6'].deskIndex, null);
  state = reduce(state, ev('SessionEnd', { session_id: 's0', ts: T0 + 100 }));
  // 窗內：s0 雖下線但畫面上還在，座位仍被佔，候補的 s6 補不到（避免同桌）。
  const inWindow = reduce(state, ev('PreToolUse', { session_id: 's6', ts: T0 + 200, tool_name: 'Read' }));
  assert.equal(inWindow.agents['s6'].deskIndex, null);
  // 超時：s0 的座位真正釋出，s6 這個事件補進 desk 0。
  const afterWindow = reduce(state, ev('PreToolUse', { session_id: 's6', ts: T0 + 100 + 31 * 60 * 1000, tool_name: 'Read' }));
  assert.equal(afterWindow.agents['s6'].deskIndex, 0);
});

test('亂序事件（ts 早於 lastEventTs）被丟棄，SessionEnd 後不會被舊事件復活', () => {
  let state = reduce(emptyState(), ev('SessionStart'));
  state = reduce(state, ev('PreToolUse', { ts: T0 + 5000, tool_name: 'Bash' }));
  state = reduce(state, ev('SessionEnd', { ts: T0 + 6000 }));
  const after = reduce(state, ev('PreToolUse', { ts: T0 + 1000, tool_name: 'Edit' }));
  assert.equal(after.agents['sess-1'].status, STATUS.OFFLINE);
  assert.equal(after.agents['sess-1'].lastEventTs, T0 + 6000);
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
  // 兩個「不同 cwd」（不會被同專案去重併掉）但 basename 都是 api、皆單層無上層目錄，
  // 撞名時退回 session 短碼當區分後綴。
  let state = emptyState();
  state = reduce(state, ev('SessionStart', { session_id: 'aaaa-1', ts: T0, cwd: '/api' }));
  state = reduce(state, ev('SessionStart', { session_id: 'bbbb-2', ts: T0 + 1, cwd: '/api/' }));
  const names = deriveAgents(state, T0 + 2).map((a) => a.name).sort();
  assert.deepEqual(names, ['api (aaaa)', 'api (bbbb)']);
});

test('deriveAgents：同一專案多個 session 只顯示最新那個活著的（不擠一排同名）', () => {
  let state = emptyState();
  const cwd = '/Users/yanchen/workspace/ai-agent-room';
  // 同一專案先後開 3 個 session：前兩個較舊、最後一個最新，全都活著（沒 SessionEnd）。
  state = reduce(state, ev('SessionStart', { session_id: 'old-1', ts: T0, cwd }));
  state = reduce(state, ev('SessionStart', { session_id: 'old-2', ts: T0 + 1000, cwd }));
  state = reduce(state, ev('UserPromptSubmit', { session_id: 'new-3', ts: T0 + 2000, cwd }));
  const shown = deriveAgents(state, T0 + 3000);
  const room = shown.filter((a) => a.cwd === cwd);
  assert.equal(room.length, 1, '同專案只留一個');
  assert.equal(room[0].sessionId, 'new-3', '留的是最新那個');
});

test('deriveAgents：同專案去重取最新，但不同專案各自保留', () => {
  let state = emptyState();
  const a = '/Users/yanchen/workspace/ai-agent-room';
  const b = '/Users/yanchen/workspace/wez-rag';
  state = reduce(state, ev('SessionStart', { session_id: 'a1', ts: T0, cwd: a }));
  state = reduce(state, ev('SessionStart', { session_id: 'a2', ts: T0 + 1000, cwd: a }));
  state = reduce(state, ev('SessionStart', { session_id: 'b1', ts: T0 + 500, cwd: b }));
  const shown = deriveAgents(state, T0 + 2000);
  const cwds = shown.map((x) => x.cwd).sort();
  assert.deepEqual(cwds, [a, b], '兩個專案各一個');
  assert.equal(shown.find((x) => x.cwd === a).sessionId, 'a2');
});

test('deriveAgents：同專案僅剩 offline session 時仍顯示（下班了還看得到，直到移除窗過期）', () => {
  let state = emptyState();
  const cwd = '/Users/yanchen/workspace/ai-agent-room';
  state = reduce(state, ev('SessionStart', { session_id: 'gone', ts: T0, cwd }));
  state = reduce(state, ev('SessionEnd', { session_id: 'gone', ts: T0 + 1000, cwd }));
  const shown = deriveAgents(state, T0 + 2000);
  const room = shown.filter((a) => a.cwd === cwd);
  assert.equal(room.length, 1, 'offline 仍在顯示窗內，看得到');
  assert.equal(room[0].sessionId, 'gone');
});

test('deriveAgents：同專案一個活著一個 offline，只顯示活的那個（不留下班墓碑）', () => {
  let state = emptyState();
  const cwd = '/Users/yanchen/workspace/ai-agent-room';
  state = reduce(state, ev('SessionStart', { session_id: 'dead', ts: T0, cwd }));
  state = reduce(state, ev('SessionEnd', { session_id: 'dead', ts: T0 + 500, cwd }));
  state = reduce(state, ev('UserPromptSubmit', { session_id: 'alive', ts: T0 + 1000, cwd }));
  const shown = deriveAgents(state, T0 + 2000);
  const room = shown.filter((a) => a.cwd === cwd);
  assert.equal(room.length, 1, '活人在就不顯示下班的');
  assert.equal(room[0].sessionId, 'alive');
  assert.notEqual(room[0].status, STATUS.OFFLINE);
});

test('活動 feed 記錄事件、上限 50 筆、最新在前', () => {
  let state = emptyState();
  for (let i = 0; i < 60; i++) {
    state = reduce(state, ev('PreToolUse', { ts: T0 + i, tool_name: `Tool${i}` }));
  }
  assert.equal(state.feed.length, 50);
  assert.equal(state.feed[0].ts, T0 + 59);
});

// --- Blocker 迴歸測試（review-sa 審出的三個上線阻擋項）---

test('B1 迴歸：下線者仍在顯示窗內時，新人不會被分到同一張桌（避免同桌重疊）', () => {
  // 每個 session 各自不同專案（cwd），避免被同專案去重併掉——這裡要測的是座位分配。
  let state = emptyState();
  for (let i = 0; i < 6; i++) {
    state = reduce(state, ev('SessionStart', { session_id: `b${i}`, ts: T0 + i, cwd: `/proj/b${i}` }));
  }
  state = reduce(state, ev('SessionEnd', { session_id: 'b0', ts: T0 + 10, cwd: '/proj/b0' }));
  state = reduce(state, ev('SessionStart', { session_id: 'b6', ts: T0 + 20, cwd: '/proj/b6' }));
  const shown = deriveAgents(state, T0 + 21);
  const b0 = shown.find((a) => a.sessionId === 'b0'); // offline 仍顯示
  const b6 = shown.find((a) => a.sessionId === 'b6'); // 新進場
  // b0 佔著 desk 0（顯示窗內），6 桌已滿，b6 只能是 null，絕不能跟 b0 同桌。
  assert.equal(b0.deskIndex, 0);
  assert.equal(b6.deskIndex, null);
  const desks = shown.map((a) => a.deskIndex).filter((d) => d !== null);
  assert.equal(new Set(desks).size, desks.length); // 無重複座位
});

test('B2 迴歸：候補 agent 即使自身沒有新事件，顯示時也會補進已釋出的空位（不留幽靈）', () => {
  // 每個 session 各自不同專案（cwd），避免被同專案去重併掉。
  let state = emptyState();
  for (let i = 0; i < 7; i++) {
    state = reduce(state, ev('SessionStart', { session_id: `c${i}`, ts: T0 + i, cwd: `/proj/c${i}` }));
  }
  assert.equal(state.agents['c6'].deskIndex, null); // 第 7 人候補
  state = reduce(state, ev('SessionEnd', { session_id: 'c0', ts: T0 + 100, cwd: '/proj/c0' }));
  // c0 座位超時釋出後，c6 自身沒有再產生任何事件 —— deriveAgents 仍應在顯示時替它補位。
  const shown = deriveAgents(state, T0 + 100 + 31 * 60 * 1000);
  const c6 = shown.find((a) => a.sessionId === 'c6');
  assert.ok(c6, 'c6 仍在清單');
  assert.notEqual(c6.deskIndex, null); // 不再是幽靈
  const seated = shown.filter((a) => a.status !== STATUS.OFFLINE);
  assert.ok(seated.every((a) => a.deskIndex !== null), '顯示中的活人都有座位');
  const desks = seated.map((a) => a.deskIndex);
  assert.equal(new Set(desks).size, desks.length); // 補位不撞座
});
