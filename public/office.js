// 前端渲染：辦公室背景 + 依 agent 狀態把角色畫到工位上，右側面板同步狀態卡與活動 feed。

const canvas = document.getElementById('office');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// 工位錨點（背景圖 1536x1024 的比例座標；chair 位置，角色腳點對齊）。
// 對照 assets/office-bg.png 兩排各三張桌子的實際位置，看圖後微調。
const DESKS = [
  { x: 0.235, y: 0.395 },
  { x: 0.500, y: 0.395 },
  { x: 0.765, y: 0.395 },
  { x: 0.235, y: 0.735 },
  { x: 0.500, y: 0.735 },
  { x: 0.765, y: 0.735 },
];
const SPRITE_H = 150; // 角色顯示高度 px（畫布座標）

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

// 白底姿勢表 → 去背（近白色轉透明），回傳每格的離屏 canvas。
function slicePoses(sheet) {
  const cols = 3;
  const rows = 2;
  const w = Math.floor(sheet.width / cols);
  const h = Math.floor(sheet.height / rows);
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = document.createElement('canvas');
      cell.width = w;
      cell.height = h;
      const cctx = cell.getContext('2d');
      cctx.drawImage(sheet, c * w, r * h, w, h, 0, 0, w, h);
      const data = cctx.getImageData(0, 0, w, h);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] > 235 && px[i + 1] > 235 && px[i + 2] > 235) px[i + 3] = 0;
      }
      cctx.putImageData(data, 0, 0);
      cells.push(cell);
    }
  }
  return cells;
}

let bg = null;
let poses = [];
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
    const cell = poses[poseFor(agent)];
    if (!cell) continue;
    const scale = SPRITE_H / cell.height;
    const w = cell.width * scale;
    const bob = agent.status === 'working' ? Math.sin(t / 12 + agent.deskIndex) * 3 : 0;
    const x = desk.x * canvas.width;
    const y = desk.y * canvas.height + bob;
    ctx.drawImage(cell, x - w / 2, y - SPRITE_H / 2, w, SPRITE_H);
    drawLabel(x, y - SPRITE_H / 2, agent);
    if (agent.status === 'working' && agent.currentTool) {
      drawToolBubble(x, y + SPRITE_H / 2 + 6, agent.currentTool);
    }
    if (agent.status === 'waiting') {
      drawToolBubble(x, y + SPRITE_H / 2 + 6, '✋ 需要批准');
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
  const [bgImg, sheet] = await Promise.all([
    loadImage('/assets/office-bg.png'),
    loadImage('/assets/agent-poses.png'),
  ]);
  bg = bgImg;
  if (sheet) poses = slicePoses(sheet);
  await poll();
  setInterval(poll, 2000);
  render();
}

main();
