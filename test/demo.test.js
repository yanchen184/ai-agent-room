import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoFeed } from '../src/demo.js';
import { deriveAgents, STATUS } from '../src/reducer.js';

const T0 = 1_700_000_000_000;

function statuses(state, now) {
  return Object.fromEntries(deriveAgents(state, now).map((a) => [a.name, a.status]));
}

test('demo 首屏就同時看得到五種狀態（working x2 / waiting / idle / sleeping）', () => {
  const feed = createDemoFeed(T0);
  const seen = statuses(feed.state(T0), T0);
  assert.equal(seen['wez-rag'], STATUS.WORKING);
  assert.equal(seen['boardgame'], STATUS.WORKING);
  assert.equal(seen['ios-app'], STATUS.WAITING);
  assert.equal(seen['ami-docs'], STATUS.IDLE);
  assert.equal(seen['teaching'], STATUS.SLEEPING);
});

test('demo 長時間掛機：時間大跳躍後狀態仍正確，且重算不隨歷史線性變慢', () => {
  const feed = createDemoFeed(T0);
  const DAY = 24 * 60 * 60 * 1000;
  feed.state(T0 + 10 * DAY); // 追趕 10 天份事件

  // 追趕後 waiting/idle/sleeping 展示位不被沖掉，演示位仍在動。
  const now = T0 + 10 * DAY;
  const seen = statuses(feed.state(now), now);
  assert.equal(seen['ios-app'], STATUS.WAITING);
  assert.equal(seen['ami-docs'], STATUS.IDLE);
  assert.equal(seen['teaching'], STATUS.SLEEPING);
  assert.equal(seen['wez-rag'], STATUS.WORKING);

  // 已追趕完的情況下，單次 state() 應該只處理增量（毫秒級），
  // 用「再前進 4 秒」呼叫 1000 次來抓全量重算的回歸（全量重算會超秒）。
  const begin = process.hrtime.bigint();
  for (let i = 1; i <= 1000; i++) feed.state(now + i * 4000);
  const elapsedMs = Number(process.hrtime.bigint() - begin) / 1e6;
  assert.ok(elapsedMs < 1000, `1000 次增量 state() 花了 ${elapsedMs}ms，疑似退回全量重算`);
});
