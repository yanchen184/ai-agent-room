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
  const SLEEP_AGO = 12 * 60 * 1000; // 讓 demo-4 一開場就「睡著」（超過 10 分鐘沒動靜）

  DEMO_PROJECTS.forEach((cwd, i) => {
    // demo-4 的事件戳在 12 分鐘前，好讓它一進畫面就是 sleeping。
    const born = i === 4 ? now - SLEEP_AGO : startedAt + i * 1500;
    events.push({ ts: born, hook_event_name: 'SessionStart', session_id: `demo-${i}`, cwd });
    events.push({
      ts: born + 800,
      hook_event_name: 'UserPromptSubmit',
      session_id: `demo-${i}`,
      cwd,
      prompt: pick(PROMPTS, i),
    });
  });

  // 開場就鋪滿五種狀態，首屏 5 秒內看到全部賣點：
  //   demo-0 working（打字）、demo-1 working（用工具）、demo-2 waiting（舉手等批准）、
  //   demo-3 idle（喝咖啡）、demo-4 sleeping（上面戳在 12 分鐘前）。
  // 展示位事件的 ts 必須晚於該 session 自己的 UserPromptSubmit（reducer 會丟棄 ts 倒退的亂序事件）。
  events.push({
    ts: startedAt + 3000, hook_event_name: 'PreToolUse',
    session_id: 'demo-1', cwd: DEMO_PROJECTS[1], tool_name: 'Edit',
  });
  events.push({
    ts: startedAt + 4600, hook_event_name: 'Notification',
    session_id: 'demo-2', cwd: DEMO_PROJECTS[2], message: '等待權限批准',
  });
  events.push({
    ts: startedAt + 6100, hook_event_name: 'Stop',
    session_id: 'demo-3', cwd: DEMO_PROJECTS[3],
  });

  let cursor = events.length;
  let lastTs = startedAt + 6100;
  let running = emptyState();

  // 只讓「演示位」demo-0 / demo-1 動起來製造 working 的工具切換感；
  // demo-2（waiting）、demo-3（idle）、demo-4（sleeping）維持開場鋪好的狀態當展示樣本，
  // 這樣首屏永遠同時看得到五種狀態，又保留一點即時變化。
  const ACTIVE = ['demo-0', 'demo-1'];
  const STALE_GAP = 10 * 60 * 1000;

  function advance(current) {
    if (current - lastTs > STALE_GAP) {
      // 掛機太久（沒人查詢）：直接快轉到最近一分鐘，不補中間幾萬筆事件，
      // 並重鋪 waiting / idle 展示位——任何時間點打開頁面都仍是首屏五狀態。
      lastTs = current - 60_000;
      events.push({
        ts: lastTs, hook_event_name: 'Notification',
        session_id: 'demo-2', cwd: DEMO_PROJECTS[2], message: '等待權限批准',
      });
      events.push({
        ts: lastTs + 100, hook_event_name: 'Stop',
        session_id: 'demo-3', cwd: DEMO_PROJECTS[3],
      });
    }
    for (let t = lastTs + 4000; t <= current; t += 4000) {
      const sessionId = ACTIVE[cursor % ACTIVE.length];
      const idx = Number(sessionId.split('-')[1]);
      const base = { ts: t, session_id: sessionId, cwd: DEMO_PROJECTS[idx] };
      if (cursor % 5 === 4) {
        events.push({ ...base, hook_event_name: 'UserPromptSubmit', prompt: pick(PROMPTS, cursor) });
      } else {
        events.push({ ...base, hook_event_name: 'PreToolUse', tool_name: pick(TOOLS, cursor) });
      }
      cursor += 1;
      lastTs = t;
    }
  }

  return {
    state(current = Date.now()) {
      advance(current);
      // 增量折疊：只把新事件疊進運行中的狀態，事件陣列不無限成長。
      if (events.length > 0) {
        running = reduceAll(running, events);
        events.length = 0;
      }
      return running;
    },
  };
}
