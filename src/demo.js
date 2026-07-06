// Demo 模式：模擬多個 Claude Code session 的 hook 事件流，
// 讓沒安裝 hooks 的人打開就能看到辦公室運作（畫面右上會標示 DEMO）。

import { emptyState, reduceAll } from './reducer.js';

const DEMO_PROJECTS = [
  '/Users/demo/workspace/wez-rag',
  '/Users/demo/workspace/boardgame',
  '/Users/demo/workspace/ios-app',
  '/Users/demo/workspace/ami-docs',
  '/Users/demo/workspace/teaching',
];

const TOOLS = ['Read', 'Edit', 'Bash', 'Grep', 'Write', 'WebSearch'];
const PROMPTS = [
  '修掉登入頁的 race condition',
  '幫 README 補安裝步驟',
  '把報表匯出改成串流',
  '新增深色模式',
  '重構訂單服務的錯誤處理',
];

function pick(list, i) {
  return list[i % list.length];
}

export function createDemoFeed(now = Date.now()) {
  const events = [];
  const startedAt = now - 60_000;

  DEMO_PROJECTS.forEach((cwd, i) => {
    events.push({
      ts: startedAt + i * 1500,
      hook_event_name: 'SessionStart',
      session_id: `demo-${i}`,
      cwd,
    });
    events.push({
      ts: startedAt + i * 1500 + 800,
      hook_event_name: 'UserPromptSubmit',
      session_id: `demo-${i}`,
      cwd,
      prompt: pick(PROMPTS, i),
    });
  });

  let cursor = events.length;

  function advance(current) {
    // 每 4 秒左右讓某隻 agent 動一下，輪流製造 working / waiting / idle 的變化。
    const last = events[events.length - 1].ts;
    for (let t = last + 4000; t <= current; t += 4000) {
      const i = cursor % DEMO_PROJECTS.length;
      const roll = cursor % 9;
      const base = { ts: t, session_id: `demo-${i}`, cwd: pick(DEMO_PROJECTS, i) };
      if (roll === 7) {
        events.push({ ...base, hook_event_name: 'Notification', message: '等待權限批准' });
      } else if (roll === 8) {
        events.push({ ...base, hook_event_name: 'Stop' });
      } else if (roll === 4) {
        events.push({
          ...base,
          hook_event_name: 'UserPromptSubmit',
          prompt: pick(PROMPTS, cursor),
        });
      } else {
        events.push({ ...base, hook_event_name: 'PreToolUse', tool_name: pick(TOOLS, cursor) });
      }
      cursor += 1;
    }
  }

  return {
    state(current = Date.now()) {
      advance(current);
      return reduceAll(emptyState(), events);
    },
  };
}
