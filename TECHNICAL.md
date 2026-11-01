# RESONANCE · 技术文档

> 面向玩家与宣传的介绍见 [README.md](README.md)。本文记录架构、实现取舍、部署、统计与测试。

React 18 + Vite 5 + Express + ws，**单进程**：`node server.js` 一条命令兼 dev server（Vite middlewareMode，HMR 走 `PORT+1`）与生产静态托管（`--prod` 托管 `dist/`）+ WebSocket。房间状态全部在服务端内存里，不需要数据库。

## 目录

```
server.js              Express + ws；dev 时挂 Vite middleware，--prod 时托管 dist
shared/normalize.js    判同口径（前后端共用）
shared/distance.js     默契里程的账本和参照物（前后端共用）
src/useRoom.js         WebSocket 连接、状态同步、刷新续座、邀请链接优先
src/components/Shell.jsx  顶栏 + 两栏外壳（窄屏自动单栏）
src/components/Bubbles.jsx  弹幕气泡层＋ ChatBar 底部细输入
src/laneMath.js        弹幕轨道分配（挑最早空出来的轨道，定死不再跳轨）
src/screens/           Home / Lobby / Play / Reveal
server/stats.js        访问统计（JSON 落盘，匿名指纹去重）
server/backup.js       统计备份到 Supabase（可选）
render.yaml            Render Blueprint
test/                  见「测试」一节
```

## 游戏规则实现

- 4 位数字房号，2–16 人，房主开局；**无题库、无计分、无题数**
- 所有人同时填一个词（1–8 字），作答阶段公共 payload 一律 `word: null`，`myWord` 逐人下发；全员交完立即揭晓并按词分组
- 判同唯一口径 `shared/normalize.js`：去首尾空白 → 全角转半角 → 小写 → 去空白 → 去标点。所以「苹果」「苹果！」「苹果。」算同一个词，「苹果」和「红苹果」不算
- 默契里程 `shared/distance.js`：一轮没对上，在场每人背 200 m，累计出「这局要一起跑完的距离」，配参照物（操场圈、马拉松、城市间距）
- 房主设置（大厅里改，开局后锁定）：每轮限时 15–120 秒（服务端出厂值 `ROUND_SECONDS`，房间设置优先）、题目最多 16 字（留空即纯默契）
- `leave` 消息立刻腾座位并顺位继承房主；`/healthz` 给 Render 健康检查/防休眠

## 关键实现点

- **邀请链接** `?r=<房号>`：Home 自动切「进房间」并回填；`useRoom` 的 `initialSession()` 在邀请码与本地 session 房号不一致时清旧座位，否则点朋友链接会被拽回上一局
- **断线续座**：掉线保留座位 90 秒，刷新页面能续上；房主掉线自动顺位转移
- **弹幕不跳轨**：每条气泡出生时经 `laneMath.js` 的 allocator 拿一条固定轨道（挑最早空出的轨道 + `--dm-delay` 排队），飘完即散。绝不用 `i % LANES` 下标——那样删一条全体跳轨
- **弹幕限流**：一句话最多 30 字，800ms 内连发丢弃
- **手机存图**：iOS Safari / 微信内置浏览器不认 `a[download]`，改弹全屏 save sheet（`src/share.js` 的 `openSaveSheet`），长按图片存相册，`-webkit-touch-callout: default`；桌面仍走直接下载。移动端判定 `isMobileDevice()` 含 UA 正则（MicroMessenger/HarmonyOS）+ iPadOS（maxTouchPoints>1 && Mac）
- **统计无侵入**：不存原始 IP/UA，只有 sha256(IP+UA) 截断指纹

## 访问统计

服务端自带轻量统计（`server/stats.js`），无数据库、无第三方脚本：

- 页面打开打 `/api/hit` 记 PV；带 `?r=` 的算「邀请链接打开」
- UV / 会话按 IP+UA 指纹去重；建房、落座、轮数、对局、弹幕条数、常用昵称排行也在记
- 数据落在 `data/stats.json`（已 gitignore），每次变动 2 秒后合并写入，保留 120 天按天明细

**后台面板 `/admin`**：

- 本机跑（没设 `STATS_TOKEN`）：仅 `127.0.0.1` 可开
- 线上：Render Environment 里设 `STATS_TOKEN`（随机字符串），访问 `https://<域名>/admin?token=<密钥>`
- `STATS_DISABLE=1` 整体关掉

### Supabase 备份（可选）

Render 免费档磁盘是临时的，实例重建 `data/stats.json` 就没了。备份链路（`server/backup.js`）：启动 15 秒后推第一次、之后每 6 小时推一次（SIGINT/SIGTERM 退出前也推）；本地文件丢失的实例重启时自动从 Supabase 拉回备份接着记；推送时文件未落盘会先触发一次 save，再缺失则跳过。

**① Supabase 建表**（不用把仓库连到 Supabase）——SQL Editor 跑：

```sql
create table if not exists sync_stats (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
```

RLS 开不开都行——用的是 service_role / `sb_secret_` 密钥，绕过 RLS；**不要**给这张表建 anon 策略。

**② Render 环境变量**：

| Key | Value | 从哪拿 |
| --- | --- | --- |
| `SUPABASE_URL` | `https://xxxx.supabase.co` | Settings → API → Project URL |
| `SUPABASE_SERVICE_KEY` | `sb_secret_...` 或 `eyJhbGciOi...` | Settings → API → Secret keys（**不是** publishable key；用 publishable 会报 42501 RLS 错误） |

**③ 完事**。`SUPABASE_STATS_TABLE` 可换表名，默认 `sync_stats`。

> service_role / `sb_secret_` 密钥权限很大，只能放服务端环境变量，别提交进仓库、别放前端。

**本地数据合并上云**（一次性）：`scripts/merge-stats-up.mjs`，把本地 stats.json 增量合并进 Supabase 备份（totals/history 按天求和、seen 取并集取最新时间戳）：

```powershell
$env:SUPABASE_URL='https://xxxx.supabase.co'
$env:SUPABASE_SERVICE_KEY='sb_secret_...'
node scripts/merge-stats-up.mjs          # 预览
node scripts/merge-stats-up.mjs --write  # 写入；写完立刻 Restart 线上实例，抢在 6 小时自动推送之前
```

## 测试

```bash
node server.js            # 先起服务
node test/smoke.mjs       # 逻辑冒烟：16 个 ws 客户端跑完整一局，46 条断言（设置/限时/题目/里程/弹幕/统计）
node test/lanes.mjs       # 弹幕轨道分配单测（铺轨、排队、不跳轨、轨道复用）
node test/shots.mjs       # CDP 驱动无头 Chrome 出截图：桌面 1440×900 + 手机 390×844（含手机长按存图）
node test/backup.mjs      # 备份推/恢复链路（mock PostgREST）
node test/merge-stats.mjs # 合并语义单测
node test/shots.mjs       # 截图输出到 shots/，精选进 docs/
```

生产模式同一套：

```bash
npm run build
PORT=5180 node server.js --prod
WS_URL=ws://localhost:5180/ws node test/smoke.mjs
```

## 部署

**必须有常驻 WebSocket**，平台选择受限：

| 方案 | 能不能用 | 说明 |
| --- | --- | --- |
| **Render（单服务）** | ✅ 推荐 | 一个 Web Service 同时托管静态文件和 `/ws`，同域不用配 CORS。免费档 15 分钟没流量休眠，冷启动 30–50 秒 |
| Netlify 前端 + Render 后端 | ⚠️ 能，但没必要 | 变成两个域名 + 一个 `VITE_WS_URL`，多一处故障点 |
| Netlify 单独 | ❌ | Functions 撑不住长连接 |
| Supabase Realtime 替代后端 | ⚠️ 能，但要重写 | 房态搬到客户端、丢服务端权威，判同和准入容易被绕 |
| Railway / Fly / VPS | ✅ | 常驻进程，`npm start` 即可 |

**Render 一把梭**：仓库带 `render.yaml`，控制台 New → Blueprint 选仓库直接起：

```yaml
buildCommand: npm ci && npm run build
startCommand: npm start          # node server.js --prod
healthCheckPath: /healthz
```

防休眠：cron-job.org / UptimeRobot 每 10 分钟打一下 `/healthz`（免费额度够用）。

## 已知取舍

- 房间状态在内存里，进程重启就没了；未做多实例广播（要上 Redis adapter 才能多开）
- 掉线保留座位 90 秒，超时清掉
- 一局最多 16 人，再多体验就散了
- 统计备份只保最后一份快照（6 小时粒度），不是逐条日志
