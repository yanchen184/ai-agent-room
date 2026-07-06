// 零依賴 Node server：靜態頁 + /api/state。事件來源 = hooks 寫的 events.jsonl。
// `node server.js --demo` 會改用內建模擬事件流，沒裝 hooks 也能看到辦公室運作。

import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { emptyState, reduceAll, deriveAgents, parseEventLine } from './src/reducer.js';
import { createDemoFeed } from './src/demo.js';

const ROOT = new URL('.', import.meta.url).pathname;
const PORT = Number(process.env.PORT || 4680);
const EVENTS_FILE =
  process.env.CLAUDE_OFFICE_EVENTS || join(homedir(), '.claude', 'office', 'events.jsonl');
const DEMO_MODE = process.argv.includes('--demo');
const MAX_READ_BYTES = 5 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

const demo = DEMO_MODE ? createDemoFeed() : null;

let cache = { size: -1, state: emptyState() };

function readEvents() {
  if (demo) return demo.state();
  if (!existsSync(EVENTS_FILE)) return emptyState();
  const { size } = statSync(EVENTS_FILE);
  if (size === cache.size) return cache.state;
  const buffer = readFileSync(EVENTS_FILE);
  const slice =
    buffer.length > MAX_READ_BYTES ? buffer.subarray(buffer.length - MAX_READ_BYTES) : buffer;
  const events = slice
    .toString('utf8')
    .split('\n')
    .map(parseEventLine)
    .filter(Boolean);
  cache = { size, state: reduceAll(emptyState(), events) };
  return cache.state;
}

function sendJson(res, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(body);
}

function sendStatic(res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const candidates = [join(ROOT, 'public', safe), join(ROOT, safe)];
  const filePath = candidates.find(
    (p) => p.startsWith(ROOT) && existsSync(p) && statSync(p).isFile(),
  );
  if (!filePath) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
  res.end(readFileSync(filePath));
}

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  if (pathname === '/api/state') {
    const state = readEvents();
    const now = Date.now();
    sendJson(res, {
      generatedAt: now,
      demo: DEMO_MODE,
      agents: deriveAgents(state, now),
      feed: state.feed.slice(0, 30),
    });
    return;
  }
  sendStatic(res, pathname);
});

server.listen(PORT, () => {
  console.log(
    `[office] http://localhost:${PORT}  mode=${DEMO_MODE ? 'demo' : `events:${EVENTS_FILE}`}`,
  );
});
