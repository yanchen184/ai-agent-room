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
  if (!event || !event.session_id || !event.hook_event_name) return state;
  const base = ensureAgent(state, event);
  const updated = applyEvent(base, event);
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
  return Object.values(state.agents)
    .filter(
      (a) => a.status !== STATUS.OFFLINE || now - a.lastEventTs < REMOVE_OFFLINE_AFTER_MS,
    )
    .map((a) => {
      const stale = now - a.lastEventTs > SLEEP_AFTER_MS;
      const shouldSleep =
        stale && (a.status === STATUS.WORKING || a.status === STATUS.IDLE);
      return shouldSleep ? { ...a, status: STATUS.SLEEPING, currentTool: null } : { ...a };
    })
    .sort((x, y) => (x.deskIndex ?? 99) - (y.deskIndex ?? 99));
}
