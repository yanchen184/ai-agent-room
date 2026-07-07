import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { get as httpGet } from 'node:http';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 4791; // 測試專用埠，避開預設 4680

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 用 node:http（穩定 API），避開 v18 experimental fetch 的相容問題。
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

async function startServer() {
  const child = spawn('node', [join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 50; i++) {
    try {
      await get('/api/state');
      return child;
    } catch {
      await sleep(100);
    }
  }
  child.kill();
  throw new Error('server 起不來');
}

// 整段 round-trip 放在單一 test 內自 spawn 自殺，
// 避開 v18.12 node:test 的 before/after + 常駐子行程相容坑。
test('server round-trip：B3 檔案洩漏防護 + 正常資產 + API envelope', async () => {
  const child = await startServer();
  try {
    // B3: 不得洩漏 ROOT 內原始碼
    const srcJs = await get('/server.js');
    assert.equal(srcJs.status, 404, '/server.js 應 404，不能回原始碼');
    assert.doesNotMatch(srcJs.body, /零依賴 Node server/);

    // B3: 不得洩漏 .claude 設定檔
    assert.equal((await get('/.claude/settings.json')).status, 404);

    // B3: path traversal 逃出 ROOT 一律 404
    for (const p of ['/../../../../etc/passwd', '/public/../server.js', '/..%2f..%2fserver.js']) {
      assert.equal((await get(p)).status, 404, `${p} 應 404`);
    }

    // 正常前端資產仍服務得到
    const html = await get('/');
    assert.equal(html.status, 200);
    assert.match(html.body, /<html|<!doctype/i);

    // /api/state 回合法 JSON envelope
    const api = await get('/api/state');
    assert.equal(api.status, 200);
    const data = JSON.parse(api.body);
    assert.ok(Array.isArray(data.agents));
    assert.ok(Array.isArray(data.feed));
    assert.equal(typeof data.generatedAt, 'number');
  } finally {
    child.kill();
  }
});
