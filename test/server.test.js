import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { get as httpGet } from 'node:http';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 4791; // 測試專用埠，避開預設 4680

let child;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 用 node:http（穩定 API），避開 v18 experimental fetch 在 test runner 子行程的相容問題。
function get(path) {
  return new Promise((resolve, reject) => {
    const req = httpGet(`http://127.0.0.1:${PORT}${path}`, (res) => {
      let body = '';
      res.on('data', (c) => {
        body += c;
      });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
  });
}

before(async () => {
  child = spawn('node', [join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  // 輪詢直到 server 真的接受連線（listen log 不保證 socket 已可連）。
  for (let i = 0; i < 50; i++) {
    try {
      await get('/api/state');
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error('server 起不來');
});

after(() => {
  child.kill();
});

test('B3 迴歸：不得洩漏 ROOT 內原始碼', async () => {
  const r = await get('/server.js');
  assert.equal(r.status, 404, '/server.js 應 404，不能回原始碼');
  assert.doesNotMatch(r.body, /零依賴 Node server/);
});

test('B3 迴歸：不得洩漏 .claude 設定檔', async () => {
  const r = await get('/.claude/settings.json');
  assert.equal(r.status, 404);
});

test('B3 迴歸：path traversal 逃出 ROOT 一律 404', async () => {
  for (const p of ['/../../../../etc/passwd', '/public/../server.js', '/..%2f..%2fserver.js']) {
    const r = await get(p);
    assert.equal(r.status, 404, `${p} 應 404`);
  }
});

test('正常前端資產仍服務得到', async () => {
  const html = await get('/');
  assert.equal(html.status, 200);
  assert.match(html.body, /<html|<!doctype/i);
});

test('/api/state 回合法 JSON envelope', async () => {
  const r = await get('/api/state');
  assert.equal(r.status, 200);
  const data = JSON.parse(r.body);
  assert.ok(Array.isArray(data.agents));
  assert.ok(Array.isArray(data.feed));
  assert.equal(typeof data.generatedAt, 'number');
});
