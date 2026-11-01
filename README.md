# RESONANCE · 共振

Same moment, one word. 同一时间各写一个词，全都一样才说明想的是同一件事。

![RESONANCE](docs/home.png)

React + 一个 WebSocket 服务，房间状态全部在服务端内存里，不需要数据库。

- 桌面是双栏版面（左边题目/房号，右边在场的人），窄屏自动回落单栏，手机上一样好用
- 2–16 人，4 位房号，房间可分享成链接（`?r=8321`），点开直接跳到「进房间」并填好房号
- 刷新页面不会丢座位，掉线 90 秒内回来还坐原位
## 跑起来

```bash
npm install
npm run dev          # http://localhost:5173
```

改端口：`PORT=8080 npm run dev`

## 玩法

- 4 位数字房号，2–16 人，房主开局
- 默认**没有题目**（纯默契）；房主也可以在大厅里出一道题（比如「一种热带水果」），全员照着题想
- 所有人同时想一个词（1–8 字），谁先交都不影响，交完互相看不到
- 全员交完立即揭晓，按词分组，把每个人填的词和名字都摆出来
- 全一样 → 撞上了，这一局结束；不一样 → 房主点「再写一次」
- 一直填到所有人都一样为止，没有题数，也不计分
- **默契里程**：一轮没对上，在场每人背 200 m，累计出「这局要一起跑完的距离」；页面和揭晓页都会显示，配点好玩的参照——操场几圈、几个马拉松、够不够从上海跑到北京
- **弹幕发言**：从建房开始随时冒一句——底部输入一句话，所有人的屏幕上飘过一条气泡，飘过就散，不留历史、不占版面；一句话最多 30 个字，800ms 内的连发会被悄悄丢掉
- 结束后可以看**对局记录**：浮层里逐轮列出，能复制成文字或存成一张矩阵图（人是一列，轮次是一行），里程板块和每轮背了多少米都在
- 存图分两条路：电脑上直接下载到「下载」文件夹；手机上（含微信内置浏览器、iOS Safari）不认 `a[download]`，改成弹一个全屏浮层，**长按图片存到相册**，点遮罩收起

![揭晓](docs/reveal.png)

![答题页 · 弹幕](docs/play.png)

![分享图](docs/share.png)

### 房主设置（大厅里改，开局后锁定）

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| 每轮限时 | 30 秒 | 15 / 30 / 45 / 60 / 90 / 120 秒可选；到点没交的人不参与判定，按已交的结算 |
| 题目 | 空 | 最多 16 个字，留空就是纯默契；题目会出现在答题页和分享图上 |

服务端出厂值可用 `ROUND_SECONDS=30` 环境变量调，房主在房间里改的设置优先于出厂值。

判定口径在 `shared/normalize.js`：去首尾空白、全角转半角、转小写、去所有空白和标点。
所以「苹果」「苹果！」「苹果。」算同一个词，「苹果」和「红苹果」不算。

## 结构

```
server.js              Express + ws；dev 时挂 Vite middleware，--prod 时托管 dist
shared/normalize.js    判同口径（前后端共用）
shared/distance.js     默契里程的账本和参照物（前后端共用）
src/useRoom.js         WebSocket 连接、状态同步、刷新续座、邀请链接优先
src/components/Shell.jsx  顶栏 + 两栏外壳（窄屏自动单栏）
src/components/Bubbles.jsx  弹幕气泡层（每条气泡各占一条轨道，飘过即散）＋ ChatBar 底部细输入
src/laneMath.js        弹幕轨道分配（挑最早空出来的轨道，定死不再跳轨）
src/screens/           Home / Lobby / Play / Reveal
test/smoke.mjs         16 个 ws 客户端跑完整一局，46 条断言（含设置/限时/题目/里程/弹幕/统计）
test/lanes.mjs         弹幕轨道分配单测（铺轨、排队、不跳轨、轨道复用）
test/shots.mjs         CDP 驱动无头 Chrome，桌面 1440×900 + 手机 390×844 各走一遍（含手机长按存图）
server/stats.js        访问统计（JSON 落盘，匿名指纹去重，不存原始 IP/UA）
server/backup.js       统计备份到 Supabase（可选，配置环境变量即启用）
render.yaml            Render Blueprint
```

## 访问统计

服务端自带一套轻量统计，无数据库、无第三方脚本：

- 每次页面打开打一次 `/api/hit` 记 PV；带 `?r=` 的算「邀请链接打开」
- UV / 会话按 **IP+UA 的 sha256 截断指纹**去重，不存原始 IP 和 UA
- 建房、落座、轮数、对局、弹幕条数也在记，后台能看到常用昵称排行
- 数据落在 `data/stats.json`（已 gitignore），每次变动 2 秒后合并写入，保留 120 天按天明细

后台面板：`/admin`。

- 本机跑（没设 `STATS_TOKEN`）：只有 `127.0.0.1` 能打开，直接访问 `http://localhost:5173/admin`
- 部署后：在 Render 的 Environment 里加 `STATS_TOKEN`（值自己定，一串随机的字符就行），然后开
  `https://<域名>/admin?token=你设的密钥`；不设 token 线上就只有本机能看
- `STATS_DISABLE=1` 整体关掉

### 长期保存：每天自动备份到 Supabase（可选）

Render 免费档的磁盘是临时的，实例一重建 `data/stats.json` 就没了。配一个 Supabase 备份，实例重建也能接着记：

**① Supabase 建表**（不用把仓库连到 Supabase，建个表、拿两个值就行）：
项目里 SQL Editor 跑：

```sql
create table if not exists sync_stats (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
```

RLS 开不开都行——我们用的是 service_role 密钥，它绕过 RLS；**不要**给这张表建 anon 策略。

**② Render 配两个环境变量**（Environment → Add）：

| Key | Value | 从哪拿 |
| --- | --- | --- |
| `SUPABASE_URL` | `https://xxxx.supabase.co` | 项目 Settings → API → Project URL |
| `SUPABASE_SERVICE_KEY` | `eyJhbGciOi...`（很长） | 项目 Settings → API → `service_role` secret |

**③ 就完事了**。行为：启动 15 秒后推第一次、之后每 6 小时推一次（退出前也推）；本地文件丢了的实例重启时会自动从 Supabase 把备份拉回来接着记。`SUPABASE_STATS_TABLE` 可换表名，默认 `sync_stats`。

> `service_role` 密钥权限很大，只能放在 Render 这类服务端环境变量里，别提交进仓库、别放到前端。

## 测试

```bash
node server.js            # 先起服务
node test/smoke.mjs       # 逻辑冒烟（16 人在场、越权拦截、判同、离开）
node test/lanes.mjs       # 弹幕轨道分配单测
node test/shots.mjs       # 出截图到 shots/
```

生产模式也跑同一套：

```bash
npm run build
PORT=5180 node server.js --prod
WS_URL=ws://localhost:5180/ws node test/smoke.mjs
```

## 部署

这个应用**必须有常驻 WebSocket**，所以能选的平台不多。

| 方案 | 能不能用 | 说明 |
| --- | --- | --- |
| **Render（单服务）** | ✅ 推荐 | 一个 Web Service 同时托管静态文件和 `/ws`，同域，不用配 CORS。免费档 15 分钟没流量会休眠，冷启动 30–50 秒 |
| Netlify 前端 + Render 后端 | ⚠️ 能，但没必要 | Netlify 只能托管静态文件，长连接还得落到 Render；变成两个域名 + 一个 `VITE_WS_URL`，多一处故障点 |
| Netlify 单独 | ❌ | Functions 撑不住长连接，静态托管更没有服务端 |
| Supabase Realtime 替代后端 | ⚠️ 能，但要重写 | 房间状态、房主迁移、断线重连都得搬到客户端；免费档 Realtime 有并发上限，且服务端权威逻辑没了，判同和准入容易被绕 |
| Railway / Fly / VPS | ✅ | 一样是常驻进程，`npm start` 即可 |

### Render 一把梭

仓库里带了 `render.yaml`，控制台 **New → Blueprint** 选这个仓库，直接起：

```yaml
buildCommand: npm ci && npm run build
startCommand: npm start          # node server.js --prod
healthCheckPath: /healthz
```

起来之后拿到 `https://<名称>.onrender.com`，把这个链接发给朋友就行。
房间页有「复制邀请链接」，生成的是 `https://<域名>/?r=房号`。

> 免费档休眠：第一次打开要等 30–50 秒。想避免就用 cron-job.org / UptimeRobot
> 每 10 分钟打一下 `https://<域名>/healthz`（免费额度够用）。

## 已知取舍

- 房间状态在内存里，进程重启就没了；也没做多实例广播（要上 Redis adapter 才能多开）
- 掉线保留座位 90 秒，刷新页面能续上；超时会被清掉
- 房主掉线会自动把房主身份交给下一个在线的人
- 一局最多 16 人，再多游戏体验就散了
