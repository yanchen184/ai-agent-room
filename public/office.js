// 前端渲染：辦公室背景 + 依 agent 狀態把角色畫到工位上，右側面板同步狀態卡與活動 feed。

const canvas = document.getElementById('office');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// 工位錨點（背景圖 1536x1024 的比例座標；chair 位置，角色腳點對齊）。
// 對照 assets/office-bg.png 兩排各三張桌子的實際位置，看圖後微調。
const DESKS = [
  { x: 0.247, y: 0.475 },
  { x: 0.491, y: 0.475 },
  { x: 0.732, y: 0.475 },
  { x: 0.247, y: 0.740 },
  { x: 0.491, y: 0.740 },
  { x: 0.732, y: 0.740 },
];
const SPRITE_H = 190; // 角色顯示高度 px（畫布座標）

// 姿勢表 assets/agent-poses.png：3x2 格。狀態 → 格子索引。
const POSE = { typing: 0, idle: 1, raise: 2, reading: 3, coffee: 4, sleeping: 5 };

function poseFor(agent) {
  switch (agent.status) {
    case 'working':
      return ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'].includes(agent.currentTool)
        ? POSE.reading
        : POSE.typing;
    case 'waiting': return POSE.raise;
    case 'idle': return POSE.coffee;
    case 'sleeping': return POSE.sleeping;
    default: return POSE.idle;
  }
}

const STATUS_LABEL = {
  working: '工作中',
  waiting: '等你批准',
  idle: '待命',
  sleeping: '睡著了',
  offline: '已下班',
};
const STATUS_COLOR = {
  working: '#5ec46f',
  waiting: '#eec35b',
  idle: '#8a97b8',
  sleeping: '#7a6fd0',
};

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// 近白判定（去背門檻）。
function isNearWhite(px, i) {
  return px[i] > 232 && px[i + 1] > 232 && px[i + 2] > 232;
}

// 從邊框 flood-fill 去背：只清除「與邊界相連」的近白背景，
// 保留角色身體內部的白色（全域 white-key 會把白色機身也挖掉）。
function keyOutBorderWhite(source, sx, sy, w, h) {
  const cell = document.createElement('canvas');
  cell.width = w;
  cell.height = h;
  const cctx = cell.getContext('2d');
  cctx.drawImage(source, sx, sy, w, h, 0, 0, w, h);
  const data = cctx.getImageData(0, 0, w, h);
  const px = data.data;
  const visited = new Uint8Array(w * h);
  const queue = [];
  for (let x = 0; x < w; x++) { queue.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { queue.push(y * w, y * w + w - 1); }
  while (queue.length) {
    const p = queue.pop();
    if (visited[p]) continue;
    visited[p] = 1;
    if (!isNearWhite(px, p * 4)) continue;
    px[p * 4 + 3] = 0;
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) queue.push(p - 1);
    if (x < w - 1) queue.push(p + 1);
    if (y > 0) queue.push(p - w);
    if (y < h - 1) queue.push(p + w);
  }
  cctx.putImageData(data, 0, 0);
  return cell;
}

// 白底單張 sprite → 去背後回傳離屏 canvas。
function keyOutWhite(img) {
  return keyOutBorderWhite(img, 0, 0, img.width, img.height);
}

// 白底姿勢表 → 逐格邊框 flood-fill 去背，回傳每格的離屏 canvas。
function slicePoses(sheet) {
  const cols = 3;
  const rows = 2;
  const w = Math.floor(sheet.width / cols);
  const h = Math.floor(sheet.height / rows);
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(keyOutBorderWhite(sheet, c * w, r * h, w, h));
    }
  }
  return cells;
}

let bg = null;
let poses = [];
let typingSprite = null; // 無桌子的坐姿打字 sprite（優先於姿勢表格 0，避免與背景桌子重疊）
let agents = [];
let t = 0;

function drawLabel(x, y, agent) {
  const label = agent.name.length > 14 ? `${agent.name.slice(0, 14)}…` : agent.name;
  ctx.font = '700 22px ui-monospace, Menlo, monospace';
  const tw = ctx.measureText(label).width;
  const pad = 10;
  const bw = tw + pad * 2 + 18;
  const bx = x - bw / 2;
  const by = y - 34;
  ctx.fillStyle = 'rgba(20,16,28,0.82)';
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, 32, 8);
  ctx.fill();
  ctx.fillStyle = STATUS_COLOR[agent.status] || '#8a97b8';
  ctx.beginPath();
  ctx.arc(bx + pad + 4, by + 16, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f0eae0';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bx + pad + 16, by + 17);
}

function drawToolBubble(x, y, text) {
  ctx.font = '20px ui-monospace, Menlo, monospace';
  const tw = ctx.measureText(text).width;
  const pad = 8;
  const bw = tw + pad * 2;
  const bx = x - bw / 2;
  const by = y;
  ctx.fillStyle = 'rgba(232,132,92,0.92)';
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, 28, 7);
  ctx.fill();
  ctx.fillStyle = '#1a1620';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + pad, by + 15);
}

function render() {
  t += 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (bg) ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);

  for (const agent of agents) {
    if (agent.deskIndex === null || agent.status === 'offline') continue;
    const desk = DESKS[agent.deskIndex];
    if (!desk) continue;
    const pose = poseFor(agent);
    const cell = pose === POSE.typing && typingSprite ? typingSprite : poses[pose];
    if (!cell) continue;
    const scale = SPRITE_H / cell.height;
    const w = cell.width * scale;
    const bob = agent.status === 'working' ? Math.sin(t / 12 + agent.deskIndex) * 3 : 0;
    const x = desk.x * canvas.width;
    const y = desk.y * canvas.height + bob;
    ctx.drawImage(cell, x - w / 2, y - SPRITE_H / 2, w, SPRITE_H);
    // 名牌抬到螢幕上方；工具/等待氣泡緊貼名牌下，不丟到腳下（會撞下一排名牌）。
    const labelY = y - SPRITE_H / 2 - 56;
    drawLabel(x, labelY, agent);
    if (agent.status === 'working' && agent.currentTool) {
      drawToolBubble(x, labelY + 2, agent.currentTool);
    }
    if (agent.status === 'waiting') {
      drawToolBubble(x, labelY + 2, '✋ 需要批准');
    }
  }
  requestAnimationFrame(render);
}

function relTime(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function esc(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function renderPanel(data) {
  document.getElementById('online-count').textContent = String(
    data.agents.filter((a) => a.status !== 'offline').length,
  );
  document.getElementById('demo-badge').style.display = data.demo ? 'inline-block' : 'none';
  document.getElementById('empty-hint').style.display = data.agents.length ? 'none' : 'flex';

  document.getElementById('agent-list').innerHTML = data.agents
    .map((a) => {
      const detail =
        a.status === 'working' && a.currentTool
          ? `正在用 <span class="tool">${esc(a.currentTool)}</span>`
          : a.lastPrompt
            ? `任務：${esc(a.lastPrompt)}`
            : STATUS_LABEL[a.status] || a.status;
      return `<div class="agent-card">
        <div class="row1">
          <span class="dot ${a.status}"></span>
          <span class="name" title="${esc(a.name)}">${esc(a.name)}</span>
          <span class="status-chip">${STATUS_LABEL[a.status] || a.status}</span>
        </div>
        <div class="detail">${detail} · 用了 ${a.toolUses} 次工具</div>
      </div>`;
    })
    .join('');

  document.getElementById('feed').innerHTML = data.feed
    .map(
      (f) => `<div class="feed-item">
        <span class="who">${esc(f.agent)}</span>
        <span class="what">${esc(f.event)}${f.detail ? ` · ${esc(f.detail)}` : ''}</span>
        <span class="when">${relTime(f.ts)}</span>
      </div>`,
    )
    .join('');
}

async function poll() {
  try {
    const res = await fetch('/api/state');
    const data = await res.json();
    agents = data.agents;
    renderPanel(data);
  } catch {
    // server 暫時斷線就跳過這輪，下輪再試。
  }
}

async function main() {
  const [bgImg, sheet, typingImg] = await Promise.all([
    loadImage('/assets/office-bg.png'),
    loadImage('/assets/agent-poses.png'),
    loadImage('/assets/agent-typing.png'),
  ]);
  bg = bgImg;
  if (sheet) poses = slicePoses(sheet);
  if (typingImg) typingSprite = keyOutWhite(typingImg);
  await poll();
  setInterval(poll, 2000);
  render();
}

main();
