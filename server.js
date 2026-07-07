// 零依賴 Node server：靜態頁 + /api/state。事件來源 = hooks 寫的 events.jsonl。
// `node server.js --demo` 會改用內建模擬事件流，沒裝 hooks 也能看到辦公室運作。

import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
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

// 只服務這兩個目錄；其餘（原始碼、設定檔）一律 404。
const PUBLIC_DIR = join(ROOT, 'public');
const ASSETS_DIR = join(ROOT, 'assets');

function sendStatic(res, urlPath) {
  const rel = (urlPath === '/' ? '/index.html' : urlPath).replace(/^\/+/, '');
  // 前端資產在 public/，圖檔在 assets/（URL 以 assets/ 開頭時對應 repo 根下的 assets/）。
  const base = rel.startsWith('assets/') ? ROOT : PUBLIC_DIR;
  // 先 normalize 出真實路徑，再用「目錄 + 分隔符」比真實前綴 —— 擋 ../ 穿越，
  // 也擋 /public-evil 這種同前綴字串繞過。
  const filePath = normalize(join(base, rel));
  const allowed =
    filePath.startsWith(PUBLIC_DIR + sep) || filePath.startsWith(ASSETS_DIR + sep);
  if (!allowed || !existsSync(filePath) || !statSync(filePath).isFile()) {
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

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[office] port ${PORT} 已被佔用。換個埠再跑：PORT=4699 npm run demo`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`[office] http://localhost:${PORT}`);
  if (DEMO_MODE) {
    console.log('[office] 模式：DEMO（內建模擬事件，看不到你的真實 session）');
    return;
  }
  // 真實模式：把「server 讀哪個事件檔」印清楚——hook 寫的檔必須是同一個，
  // 否則會出現「session 明明在工作、辦公室卻永遠睡著」的幽靈睡眠（各寫各讀）。
  console.log(`[office] 模式：真實　事件檔：${EVENTS_FILE}`);
  if (process.env.CLAUDE_OFFICE_EVENTS) {
    console.log(
      '[office] ⚠️  你用 CLAUDE_OFFICE_EVENTS 指定了非預設事件檔；' +
        '請確認各專案的 hook 也用「同一個」路徑，否則辦公室會看不到 session（幽靈睡眠）。',
    );
  }
  if (!existsSync(EVENTS_FILE)) {
    console.log(
      `[office] ℹ️  事件檔尚不存在。裝好 hooks 的專案開一個 session 送訊息後，` +
        `${EVENTS_FILE} 會自動長出來，員工就會進辦公室。`,
    );
  }
});
