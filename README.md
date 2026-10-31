# 同词相见

几个人同时想一个词，撞上了才算默契。

![同词相见](docs/home.png)

「同词相见」小程序的网页版。React + 一个 WebSocket 服务，房间状态全部在服务端内存里，
不需要数据库。

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
- **没有题面**，所有人同时想一个词（1–8 字），谁先交都不影响，交完互相看不到
- 全员交完立即揭晓，按词分组，把每个人填的词和名字都摆出来
- 全一样 → 撞上了，这一局结束；不一样 → 房主点「再来一轮」
- 一直填到所有人都一样为止，没有题数，也不计分

判定口径在 `shared/normalize.js`：去首尾空白、全角转半角、转小写、去所有空白和标点。
所以「苹果」「苹果！」「苹果。」算同一个词，「苹果」和「红苹果」不算。

## 结构

```
server.js              Express + ws；dev 时挂 Vite middleware，--prod 时托管 dist
shared/normalize.js    判同口径（前后端共用）
src/useRoom.js         WebSocket 连接、状态同步、刷新续座、邀请链接优先
src/components/Shell.jsx  顶栏 + 两栏外壳（窄屏自动单栏）
src/screens/           Home / Lobby / Play / Reveal
test/smoke.mjs         16 个 ws 客户端跑完整一局，24 条断言
test/shots.mjs         CDP 驱动无头 Chrome，桌面 1440×900 + 手机 390×844 各走一遍
render.yaml            Render Blueprint
```

## 测试

```bash
node server.js            # 先起服务
node test/smoke.mjs       # 逻辑冒烟（16 人在场、越权拦截、判同、离开）
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
