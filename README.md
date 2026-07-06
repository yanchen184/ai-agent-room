# Claude Code Office — AI Agent 視覺化辦公室

把每一個 Claude Code session 變成一位「上班中的 AI 員工」：打開網頁就看到一間 pixel art 辦公室，誰在打字、誰在等你批准權限、誰發呆喝咖啡、誰睡著了，一目瞭然。素材全部由 Codex `image_gen` 生成。

![Claude Code Office Web UI](docs/images/screenshot-main.png)

## 它怎麼運作

```
Claude Code session ──(hooks)──▶ ~/.claude/office/events.jsonl ──▶ node server.js ──▶ 瀏覽器 Canvas 辦公室
```

1. **Hooks 事件流**：專案級 `.claude/settings.json` 掛 6 個 hook（SessionStart / UserPromptSubmit / PreToolUse / Notification / Stop / SessionEnd），每個事件由 `hooks/office-hook.js` 精簡成一行 JSON append 到事件檔。
2. **零依賴 Node server**：`server.js` 讀事件檔、用純函式 reducer 推導每位 agent 的狀態，提供 `/api/state`。
3. **前端 Canvas**：畫出辦公室背景，依狀態把角色擺到工位上（打字 / 舉手 / 喝咖啡 / 睡覺），右側面板是狀態卡與活動紀錄。

| 狀態 | 觸發 | 畫面 |
|---|---|---|
| working | UserPromptSubmit / PreToolUse | 坐在工位打字（查資料類工具會變成看文件），下方氣泡顯示目前工具 |
| waiting | Notification（等權限批准） | 舉手 ✋ |
| idle | Stop（回完話待命） | 喝咖啡 |
| sleeping | 超過 10 分鐘沒動靜 | 睡著 zzz |
| offline | SessionEnd | 下班離場（30 分鐘後從清單移除） |

## 快速開始

```bash
# 1. 先看 demo（不需要任何設定，內建模擬事件流，首屏就能看到五種狀態）
npm run demo
# 打開 http://localhost:4680

# 2. 接真實 Claude Code session
npm start          # 讀 ~/.claude/office/events.jsonl
```

> port 4680 被佔用時會直接提示換埠：`PORT=4699 npm run demo`。

### 讓某個專案的 session 走進辦公室

一行安裝器搞定——不用手改任何路徑：

```bash
# 在本 repo 目錄下執行（npm run 讀的是本 repo 的 package.json，別在目標專案下跑）：
npm run install-hooks -- /絕對路徑/到/你的專案
```

安裝器會把 6 個 hook 併進該專案的 `.claude/settings.json`（hook 指令用本 repo 的絕對路徑自動填好），已有的 `settings.json` / 其他 hooks 會**安全保留、不覆蓋**，動檔前先備份成 `.bak.<timestamp>`，重跑也不會重複裝。

**驗證裝好了沒（round-trip，別只信輸出）**：

1. `npm start` 讓 server 跑著（要接真實 session 必須用 `npm start`；`npm run demo` 是模擬事件，看不到你的真實 session）
2. 在剛裝好的那個專案開一個 Claude Code session、送一則訊息
3. 打開 http://localhost:4680 —— 該專案的員工應該走進辦公室

本 repo 自己已裝好 hooks——在這裡開 session 立刻看得到。

### 隱私

hook 只把事件寫進**你本機**的 `~/.claude/office/events.jsonl`，server 也只在本機聽 port，**不對外傳送任何資料**。prompt 只擷取前 200 字用於畫面顯示，可自行縮短或關掉對應 hook。

> 辦公室只有 **6 個工位**。第 7 位之後的 session 仍會列在右側清單與活動紀錄，但畫面上不佔工位；等有人下班釋出座位，候補的 session 會在下一個事件自動補位入座。

環境變數：

| 變數 | 預設 | 說明 |
|---|---|---|
| `PORT` | `4680` | server 埠 |
| `CLAUDE_OFFICE_EVENTS` | `~/.claude/office/events.jsonl` | 事件檔位置（hook 與 server 要一致） |

## 測試

```bash
npm test   # node:test — reducer 純函式 + hook 端到端（真的 spawn hook 餵 stdin）
```

## 素材

`assets/` 下所有圖（辦公室背景、角色姿勢表、favicon）由 Codex `image_gen` 生成：

```bash
/Applications/Codex.app/Contents/Resources/codex exec --sandbox workspace-write \
  -C <repo> 'Use your image_gen tool to generate ONE image, ...'
# 生成物落在 ~/.codex/generated_images/<session-id>/*.png，需自行搬到目標路徑
```

## 專案結構

```
server.js            # 零依賴 HTTP server：靜態頁 + /api/state
src/reducer.js       # 事件 → 辦公室狀態（純函式，有測試）
src/demo.js          # demo 模式的模擬事件流
hooks/office-hook.js # Claude Code hook：stdin JSON → events.jsonl
public/              # 前端（index.html + office.js，Canvas 渲染）
assets/              # Codex 生成的素材
.claude/settings.json# 本專案的 hooks 設定（session 進辦公室）
```
