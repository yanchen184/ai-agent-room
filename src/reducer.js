// 事件 → 辦公室狀態的純函式核心。server 與測試共用，前端只吃 API 輸出。

export const STATUS = {
  WORKING: 'working',
  WAITING: 'waiting',
  IDLE: 'idle',
  SLEEPING: 'sleeping',
  OFFLINE: 'offline',
};

export const DESK_COUNT = 6;
const FEED_LIMIT = 50;
const SLEEP_AFTER_MS = 10 * 60 * 1000;
const REMOVE_OFFLINE_AFTER_MS = 30 * 60 * 1000;

export function emptyState() {
  return { agents: {}, feed: [] };
}

export function parseEventLine(line) {
  if (!line || !line.trim()) return null;
  try {
    const parsed = JSON.parse(line);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function agentName(event) {
  const cwd = event.cwd || '';
  const base = cwd.split('/').filter(Boolean).pop();
  return base || `agent-${String(event.session_id || '?').slice(0, 6)}`;
}

// 撞名時的區分後綴：優先用上層目錄（client-a/api vs client-b/api），
// 沒有上層目錄可用就退回 session 短碼，保證同名專案在畫面上分得清。
function disambiguator(agent) {
  const parts = (agent.cwd || '').split('/').filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return String(agent.sessionId || '?').slice(0, 4);
}

function takenDesks(agents, exceptId) {
  return new Set(
    Object.values(agents)
      .filter((a) => a.sessionId !== exceptId && a.status !== STATUS.OFFLINE && a.deskIndex !== null)
      .map((a) => a.deskIndex),
  );
}

function assignDesk(agents, sessionId) {
  const taken = takenDesks(agents, sessionId);
  for (let i = 0; i < DESK_COUNT; i++) {
    if (!taken.has(i)) return i;
  }
  return null;
}

function ensureAgent(state, event) {
  const existing = state.agents[event.session_id];
  if (existing && existing.status !== STATUS.OFFLINE) return existing;
  return {
    sessionId: event.session_id,
    name: agentName(event),
    cwd: event.cwd || '',
    status: STATUS.IDLE,
    currentTool: null,
    lastPrompt: null,
    toolUses: 0,
    deskIndex: assignDesk(state.agents, event.session_id),
    startedAt: event.ts,
    lastEventTs: event.ts,
  };
}

function shortText(text, max = 60) {
  if (typeof text !== 'string') return null;
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

function applyEvent(agent, event) {
  const next = { ...agent, lastEventTs: event.ts };
  switch (event.hook_event_name) {
    case 'SessionStart':
      return { ...next, status: STATUS.IDLE };
    case 'UserPromptSubmit':
      return { ...next, status: STATUS.WORKING, lastPrompt: shortText(event.prompt) };
    case 'PreToolUse':
      return {
        ...next,
        status: STATUS.WORKING,
        currentTool: event.tool_name || null,
        toolUses: agent.toolUses + 1,
      };
    case 'PostToolUse':
      return { ...next, status: STATUS.WORKING };
    case 'Notification':
      return { ...next, status: STATUS.WAITING };
    case 'Stop':
    case 'SubagentStop':
      return { ...next, status: STATUS.IDLE, currentTool: null };
    case 'SessionEnd':
      return { ...next, status: STATUS.OFFLINE, currentTool: null, deskIndex: agent.deskIndex };
    default:
      return next;
  }
}

function feedEntry(agent, event) {
  return {
    ts: event.ts,
    agent: agent.name,
    sessionId: agent.sessionId,
    event: event.hook_event_name,
    detail:
      event.tool_name || shortText(event.prompt, 40) || shortText(event.message, 40) || null,
  };
}

export function reduce(state, event) {
  // ts 缺失會讓時間推導（睡眠/移除）算出 NaN 永不觸發，這種事件一律丟棄。
  if (!event || !event.session_id || !event.hook_event_name || typeof event.ts !== 'number') {
    return state;
  }
  // 亂序守衛：遲到的舊事件（ts 倒退）一律丟棄，
  // 否則 SessionEnd 之後補到的舊事件會讓已下線 agent 復活、還可能搶到別人的座位。
  const existing = state.agents[event.session_id];
  if (existing && event.ts < existing.lastEventTs) return state;
  const base = ensureAgent(state, event);
  let updated = applyEvent(base, event);
  // 候補補位：座位滿時進來的 agent（deskIndex null），在有人下班釋出座位後補進去。
  if (updated.deskIndex === null && updated.status !== STATUS.OFFLINE) {
    updated = { ...updated, deskIndex: assignDesk(state.agents, event.session_id) };
  }
  return {
    agents: { ...state.agents, [event.session_id]: updated },
    feed: [feedEntry(updated, event), ...state.feed].slice(0, FEED_LIMIT),
  };
}

export function reduceAll(state, events) {
  return events.reduce((acc, event) => reduce(acc, event), state);
}

// 查詢時間相依的呈現層狀態：睡著、離場都是「現在」相對於最後事件推導出來的。
export function deriveAgents(state, now = Date.now()) {
  const visible = Object.values(state.agents)
    .filter(
      (a) => a.status !== STATUS.OFFLINE || now - a.lastEventTs < REMOVE_OFFLINE_AFTER_MS,
    )
    .map((a) => {
      const stale = now - a.lastEventTs > SLEEP_AFTER_MS;
      const shouldSleep =
        stale && (a.status === STATUS.WORKING || a.status === STATUS.IDLE);
      return shouldSleep ? { ...a, status: STATUS.SLEEPING, currentTool: null } : { ...a };
    });

  // 撞名偵測：同一個 basename 出現 ≥2 次時，才補區分後綴，正常情況畫面零變動。
  const nameCounts = new Map();
  for (const a of visible) nameCounts.set(a.name, (nameCounts.get(a.name) || 0) + 1);

  return visible
    .map((a) => (nameCounts.get(a.name) > 1 ? { ...a, name: `${a.name} (${disambiguator(a)})` } : a))
    .sort((x, y) => (x.deskIndex ?? 99) - (y.deskIndex ?? 99));
}
