import express from 'express'
import http from 'http'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { WebSocketServer } from 'ws'
import { normalizeWord, displayWord } from './shared/normalize.js'
import { PER_ROUND_M } from './shared/distance.js'
import { createStats } from './server/stats.js'
import { backupConfigured, restoreFromRemote, startBackup } from './server/backup.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROD = process.argv.includes('--prod') || process.env.NODE_ENV === 'production'
const PORT = Number(process.env.PORT || 5173)

// ---------------------------------------------------------------- 访问统计
const STATS_FILE = process.env.STATS_FILE || path.join(__dirname, 'data', 'stats.json')
// Render 免费档磁盘是临时的：本地没文件时先从 Supabase 把上次的备份拉回来
if (backupConfigured()) await restoreFromRemote({ file: STATS_FILE })
const stats = createStats({
  file: STATS_FILE,
  disabled: process.env.STATS_DISABLE === '1',
})
const statsBackup = backupConfigured() ? startBackup({ file: STATS_FILE }) : null
const STATS_TOKEN = process.env.STATS_TOKEN || ''

// ---------------------------------------------------------------- 服务器
const app = express()
app.set('trust proxy', 1) // Render 反代后面要靠 X-Forwarded-For 拿真实 IP
const server = http.createServer(app)

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) })
})

// 访问记一笔：前端只在页面打开时打一次（比数静态资源可靠）
app.get('/api/hit', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress
  const ua = req.get('user-agent') || ''
  const referral = req.query.ref === '1'
  stats.pageview({ ip, ua, referer: req.get('referer') || '', referral })
  res.set('Cache-Control', 'no-store')
  res.json({ ok: true })
})

// 后台面板：/admin?token=xxx（没设 STATS_TOKEN 就只能从本机访问）
function adminAllowed(req) {
  if (STATS_TOKEN) return req.query.token === STATS_TOKEN
  const ip = (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '')
  return ip === '127.0.0.1' || ip === '::1'
}

app.get('/api/stats', (req, res) => {
  if (!adminAllowed(req)) return res.status(403).json({ ok: false, error: '没权限' })
  res.set('Cache-Control', 'no-store')
  res.json({
    ...stats.summary({ days: clampInt(req.query.days || 14, 1, 60) }),
    live: {
      rooms: rooms.size,
      online: [...rooms.values()].reduce((n, r) => n + activePlayers(r).length, 0),
      uptime: Math.round(process.uptime()),
    },
  })
})

app.get('/admin', (req, res) => {
  if (!adminAllowed(req)) return res.status(403).type('text/plain; charset=utf-8').send('没权限')
  res.set('Cache-Control', 'no-store')
  res.type('html').send(adminPage())
})

// ---------------------------------------------------------------- 后台面板（纯 HTML，不额外开前端路由）
function adminPage() {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex" />
<title>RESONANCE · 访问统计</title>
<style>
  :root{--bg:#ebf4f8;--panel:#fff;--ink:#11616b;--ink2:#3f7d86;--ink3:#7fa3aa;--accent:#dc8b70;--line:#c5d8de;--peach:#fed9cd}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.6 "PingFang SC","Microsoft YaHei",system-ui,sans-serif}
  .wrap{max-width:960px;margin:0 auto;padding:36px 22px 60px}
  h1{font:400 30px/1.2 Georgia,"Songti SC",serif;letter-spacing:.08em;margin:0 0 4px}
  .sub{color:var(--ink3);font-size:12px;letter-spacing:.14em;margin:0 0 26px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);margin-bottom:26px}
  .card{background:var(--panel);padding:14px 16px}
  .card b{display:block;font:400 26px/1.15 Georgia,"Songti SC",serif;letter-spacing:.02em}
  .card span{font-size:11.5px;color:var(--ink3);letter-spacing:.08em}
  .card small{display:block;color:var(--ink3);font-size:11px;margin-top:2px}
  table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);font-variant-numeric:tabular-nums}
  th,td{padding:8px 10px;text-align:right;border-bottom:1px solid #e8f0f3;font-size:12.5px}
  th:first-child,td:first-child{text-align:left;font-family:ui-monospace,Menlo,monospace;color:var(--ink2)}
  th{background:#f4fafc;color:var(--ink3);font-weight:500;font-size:11px;letter-spacing:.08em}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:26px}
  @media(max-width:720px){.two{grid-template-columns:1fr}}
  h2{font-size:11.5px;letter-spacing:.16em;color:var(--ink3);font-weight:500;margin:0 0 8px}
  .tags{display:flex;flex-wrap:wrap;gap:6px}
  .tag{background:var(--panel);border:1px solid var(--line);padding:3px 9px;font-size:12px}
  .tag i{color:var(--accent);font-style:normal;margin-left:6px}
  .live{font-size:12.5px;color:var(--ink2);margin-bottom:20px}
  .err{color:var(--accent)}
</style></head>
<body><div class="wrap">
  <h1>RESONANCE</h1>
  <p class="sub">VISITS · 访问统计</p>
  <div id="live" class="live">载入中…</div>
  <div class="cards" id="cards"></div>
  <h2>最近 14 天</h2>
  <table id="series"></table>
  <div class="two">
    <div><h2>常用昵称</h2><div class="tags" id="names"></div></div>
    <div><h2>说明</h2>
      <p style="font-size:12.5px;color:var(--ink2);margin:0">
        PV = 页面被打开的次数；UV = 去重后的独立访客（按 IP+UA 的哈希算，不存原始 IP）。<br>
        数据存在 <code>data/stats.json</code>，每次变动后 2 秒落盘。
      </p>
    </div>
  </div>
</div>
<script>
const tok = new URLSearchParams(location.search).get('token');
const url = '/api/stats' + (tok ? '?token=' + encodeURIComponent(tok) : '');
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
fetch(url).then((r) => r.json()).then((d) => {
  if (d.ok === false) throw new Error(d.error || '读不到数据');
  document.getElementById('live').textContent =
    '在线 ' + d.live.online + ' 人 · 房间 ' + d.live.rooms + ' 个 · 服务已跑 ' +
    Math.floor(d.live.uptime / 3600) + ' 小时';
  const t = d.totals, t0 = d.today;
  const cards = [
    ['今日 PV', t0.pv, '累计 ' + fmt(t.pv)],
    ['今日 UV', t0.uv, '累计 ' + fmt(t.uv)],
    ['今日会话', t0.visits, '累计 ' + fmt(t.visits)],
    ['今日新房间', t0.rooms, '累计 ' + fmt(t.rooms)],
    ['今日份对局', t0.games, '累计 ' + fmt(t.games)],
    ['今日落座', t0.players, '累计 ' + fmt(t.players)],
    ['今日轮数', t0.rounds, '累计 ' + fmt(t.rounds)],
    ['今日弹幕', t0.chats, '累计 ' + fmt(t.chats)],
    ['邀请链接打开', t0.referral, '累计 ' + fmt(t.referral)],
  ];
  document.getElementById('cards').innerHTML = cards.map(([k, v, s]) =>
    '<div class="card"><b>' + fmt(v) + '</b><span>' + k + '</span><small>' + s + '</small></div>').join('');
  const rows = d.series.slice().reverse();
  document.getElementById('series').innerHTML =
    '<tr><th>日期</th><th>PV</th><th>UV</th><th>会话</th><th>新房间</th><th>对局</th></tr>' +
    rows.map((r) => '<tr><td>' + r.day + '</td><td>' + fmt(r.pv) + '</td><td>' + fmt(r.uv) +
      '</td><td>' + fmt(r.visits) + '</td><td>' + fmt(r.rooms) + '</td><td>' + fmt(r.games) + '</td></tr>').join('');
  document.getElementById('names').innerHTML = d.topNames.length
    ? d.topNames.map((n) => '<span class="tag">' + n.name + '<i>' + n.count + '</i></span>').join('')
    : '<span style="color:var(--ink3);font-size:12.5px">还没有人落座</span>';
}).catch((e) => {
  document.getElementById('live').innerHTML = '<span class="err">读不到数据：' + e.message + '</span>';
});
</script>
</body></html>`
}

if (PROD) {
  app.use(express.static(path.join(__dirname, 'dist')))
  app.use((_req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')))
} else {
  const { createServer } = await import('vite')
  const vite = await createServer({
    server: { middlewareMode: true, hmr: { port: PORT + 1 } },
    appType: 'spa',
  })
  app.use(vite.middlewares)
}

const wss = new WebSocketServer({ server, path: '/ws' })

// ---------------------------------------------------------------- 规则常量
const MAX_PLAYERS = 16
const MAX_WORD_LEN = 8
const MAX_NAME_LEN = 12
const MAX_THEME_LEN = 16
const MAX_CHAT_LEN = 30
const CHAT_GAP_MS = 800
const OFF_KEEP_MS = 90_000
const ROOM_IDLE_MS = 30 * 60_000
// 每轮写词限时：默认 30 秒，可用 env 调整出厂值；房主在大厅里能改
const DEFAULT_ROUND_SECONDS = clampInt(process.env.ROUND_SECONDS || 30, 5, 300)

function clampInt(v, lo, hi) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}

/** @type {Map<string, any>} */
const rooms = new Map()

function uniqueCode() {
  for (let i = 0; i < 500; i += 1) {
    const code = String(Math.floor(1000 + Math.random() * 9000))
    if (!rooms.has(code)) return code
  }
  return String(Math.floor(10000 + Math.random() * 89999))
}

function createRoom() {
  const room = {
    code: uniqueCode(),
    phase: 'lobby', // lobby | answering | reveal
    hostId: null,
    players: [],
    round: 0,
    answers: new Map(),
    reveal: null,
    rounds: [],
    deadline: 0,
    timer: null,
    timedOut: false,
    // 默契里程：一轮没对上，在场每人背 200 m，累计到这局结束
    distance: 0,
    // 房主可改的设置
    roundSeconds: DEFAULT_ROUND_SECONDS,
    theme: '',
    touchedAt: Date.now(),
  }
  rooms.set(room.code, room)
  return room
}

function touch(room) {
  room.touchedAt = Date.now()
}

function cleanName(raw) {
  return displayWord(String(raw ?? '')).slice(0, MAX_NAME_LEN)
}

function addPlayer(room, name, ws) {
  const player = {
    id: crypto.randomUUID(),
    name,
    connected: true,
    ws,
    offTimer: null,
  }
  room.players.push(player)
  return player
}

function activePlayers(room) {
  return room.players.filter((p) => p.connected)
}

// ---------------------------------------------------------------- 判定
function computeReveal(room) {
  const groups = new Map()

  // 按「所有交过答案的人」统计，不只算在线的。
  // 交完就掉线的人，答案照样有效——否则会少算一个人。
  for (const p of room.players) {
    const raw = room.answers.get(p.id)
    if (raw == null) continue
    const key = normalizeWord(raw)
    if (!groups.has(key)) groups.set(key, { word: raw, count: 0, names: [] })
    const g = groups.get(key)
    g.count += 1
    g.names.push(p.name)
  }

  const list = [...groups.values()].sort(
    (a, b) => b.count - a.count || a.word.localeCompare(b.word, 'zh'),
  )

  const answeredIds = new Set([...room.answers.keys()])
  const missing = activePlayers(room)
    .filter((p) => !answeredIds.has(p.id))
    .map((p) => p.name)

  return {
    allSame: list.length === 1 && list[0].count >= 2,
    groups: list,
    round: room.round,
    answered: list.reduce((n, g) => n + g.count, 0),
    distinct: list.length,
    missing,
    timedOut: Boolean(room.timedOut),
  }
}

function clearRoundTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer)
    room.timer = null
  }
}

function maybeReveal(room, { force = false } = {}) {
  if (room.phase !== 'answering') return false
  const active = activePlayers(room)
  if (active.length < 2) return false
  const answered = active.filter((p) => room.answers.has(p.id)).length
  if (!force && answered < active.length) return false
  // 强制结算也要至少两个人交过，否则没法判「一致」
  if (force && room.answers.size < 2) return false

  clearRoundTimer(room)
  room.phase = 'reveal'
  room.reveal = computeReveal(room)

  // 默契里程：这轮没对上，在场每人背 200 m；对上了不涨
  let penalty = 0
  if (!room.reveal.allSame) {
    const n = Math.max(activePlayers(room).length, room.reveal.answered, 2)
    penalty = PER_ROUND_M * n
    room.distance += penalty
  }
  room.reveal.penalty = penalty

  stats.roundDone()
  // 对上的一局只算一次（同一个 reveal 可能被多次 broadcast）
  if (room.reveal.allSame && !room.counted) {
    room.counted = true
    stats.gameDone()
  }

  room.rounds.push({
    round: room.round,
    allSame: room.reveal.allSame,
    timedOut: room.reveal.timedOut,
    penalty,
    distance: room.distance,
    groups: room.reveal.groups.map((g) => ({
      word: g.word,
      count: g.count,
      names: g.names.slice(),
    })),
  })
  room.timedOut = false
  return true
}

function beginRound(room) {
  room.round += 1
  room.answers.clear()
  room.reveal = null
  room.timedOut = false
  room.phase = 'answering'
  const roundMs = room.roundSeconds * 1000
  // 宽限期跟着限时走：限时越短，到点后留的缓冲也短
  const graceMs = Math.max(15, Math.round(room.roundSeconds / 2)) * 1000
  room.deadline = Date.now() + roundMs
  clearRoundTimer(room)
  room.timer = setTimeout(() => {
    room.timer = null
    if (room.phase !== 'answering') return
    room.timedOut = true
    // 到点先按已交的结算；人太少就再宽限一次
    if (!maybeReveal(room, { force: true })) {
      room.timedOut = false
      room.deadline = Date.now() + graceMs
      room.timer = setTimeout(() => {
        room.timer = null
        if (room.phase !== 'answering') return
        room.timedOut = true
        maybeReveal(room, { force: true })
        broadcast(room)
      }, graceMs)
    } else {
      broadcast(room)
    }
  }, roundMs)
}

// ---------------------------------------------------------------- 下发
function publicRoom(room) {
  const active = activePlayers(room)
  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    round: room.round,
    roundSeconds: room.roundSeconds,
    theme: room.theme,
    distance: room.distance,
    reveal: room.phase === 'reveal' ? room.reveal : null,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      submitted: room.phase === 'answering' ? room.answers.has(p.id) : false,
      word: room.phase === 'reveal' ? (room.answers.get(p.id) ?? null) : null,
    })),
    answeredCount: active.filter((p) => room.answers.has(p.id)).length,
    activeCount: active.length,
    // 下发「还剩多久」而不是绝对时间，免得客户端时钟不准
    deadlineIn: room.phase === 'answering' ? Math.max(0, room.deadline - Date.now()) : 0,
    rounds: room.rounds,
  }
}

/** 拼给某个玩家看的房间快照：在公共快照上补一份「你自己写的词」。 */
function roomFor(room, player) {
  return {
    ...publicRoom(room),
    myWord: player ? (room.answers.get(player.id) ?? null) : null,
  }
}

function send(ws, payload) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload))
}

function sendError(ws, message) {
  send(ws, { type: 'error', message })
}

function broadcast(room) {
  touch(room)
  const base = publicRoom(room)
  for (const p of room.players) {
    if (!p.ws || p.ws.readyState !== 1) continue
    p.ws.send(
      JSON.stringify({
        type: 'state',
        room: { ...base, myWord: room.answers.get(p.id) ?? null },
      }),
    )
  }
}

// ---------------------------------------------------------------- 消息处理
function handleMessage(ws, msg) {
  const room = ws.roomCode ? rooms.get(ws.roomCode) : null
  const player = room ? room.players.find((p) => p.id === ws.playerId) : null

  switch (msg.type) {
    case 'create': {
      if (ws.roomCode) return sendError(ws, '你人已经在房间里了')
      const name = cleanName(msg.name)
      if (!name) return sendError(ws, '名字还没填')
      const r = createRoom()
      const p = addPlayer(r, name, ws)
      r.hostId = p.id
      ws.roomCode = r.code
      ws.playerId = p.id
      stats.playerSeated(name, { created: true })
      send(ws, { type: 'joined', playerId: p.id, room: roomFor(r, p) })
      broadcast(r)
      return
    }

    case 'join': {
      if (ws.roomCode) return sendError(ws, '你人已经在房间里了')
      const code = String(msg.code ?? '').trim()
      const name = cleanName(msg.name)
      if (!name) return sendError(ws, '名字还没填')
      const r = rooms.get(code)
      if (!r) return sendError(ws, '房间号不对，或者这间已经散了')
      if (r.phase !== 'lobby') return sendError(ws, '已经开局了，等这间散了再来')
      if (activePlayers(r).length >= MAX_PLAYERS)
        return sendError(ws, `这间最多 ${MAX_PLAYERS} 个人`)
      const p = addPlayer(r, name, ws)
      ws.roomCode = r.code
      ws.playerId = p.id
      stats.playerSeated(name, { joined: true })
      send(ws, { type: 'joined', playerId: p.id, room: roomFor(r, p) })
      broadcast(r)
      return
    }

    case 'rejoin': {
      const code = String(msg.code ?? '').trim()
      const r = rooms.get(code)
      if (!r) return sendError(ws, '这间房散了，重新开一间')
      const p = r.players.find((x) => x.id === msg.playerId)
      if (!p) return sendError(ws, '你的位子没了，重新进一次')
      if (p.offTimer) {
        clearTimeout(p.offTimer)
        p.offTimer = null
      }
      p.connected = true
      p.ws = ws
      ws.roomCode = r.code
      ws.playerId = p.id
      send(ws, { type: 'joined', playerId: p.id, room: roomFor(r, p) })
      broadcast(r)
      return
    }

    case 'settings': {
      if (!room || !player) return sendError(ws, '你还没进房间')
      if (room.hostId !== player.id) return sendError(ws, '只有房主能改设置')
      if (room.phase !== 'lobby') return sendError(ws, '开局以后不能改，等这一局散了')
      if (msg.roundSeconds != null) {
        room.roundSeconds = clampInt(msg.roundSeconds, 5, 300)
      }
      if (msg.theme != null) {
        room.theme = displayWord(String(msg.theme ?? '')).slice(0, MAX_THEME_LEN)
      }
      broadcast(room)
      return
    }

    case 'start': {
      if (!room || !player) return sendError(ws, '你还没进房间')
      if (room.hostId !== player.id) return sendError(ws, '只有房主能开')
      if (room.phase !== 'lobby') return sendError(ws, '已经开始了')
      if (activePlayers(room).length < 2) return sendError(ws, '一个人玩不了')
      room.round = 0
      room.rounds = []
      room.distance = 0
      room.counted = false
      beginRound(room)
      broadcast(room)
      return
    }

    case 'submit': {
      if (!room || !player) return sendError(ws, '你还没进房间')
      if (room.phase !== 'answering') return sendError(ws, '这会儿不用写')
      if (room.answers.has(player.id)) return sendError(ws, '这次你已经交过了')
      const word = displayWord(String(msg.word ?? ''))
      if (!word) return sendError(ws, '写一个词')
      if ([...word].length > MAX_WORD_LEN) return sendError(ws, `最多 ${MAX_WORD_LEN} 个字`)
      if (!normalizeWord(word)) return sendError(ws, '这个不算一个词')
      room.answers.set(player.id, word)
      maybeReveal(room)
      broadcast(room)
      return
    }

    case 'next': {
      if (!room || !player) return sendError(ws, '你还没进房间')
      if (room.hostId !== player.id) return sendError(ws, '只有房主能往下走')
      if (room.phase !== 'reveal') return sendError(ws, '结果还没出')
      if (room.reveal?.allSame) return sendError(ws, '已经对上了，直接开新的')
      beginRound(room)
      broadcast(room)
      return
    }

    case 'again': {
      if (!room || !player) return sendError(ws, '你还没进房间')
      if (room.hostId !== player.id) return sendError(ws, '只有房主能再开一局')
      clearRoundTimer(room)
      room.phase = 'lobby'
      room.round = 0
      room.answers.clear()
      room.reveal = null
      room.rounds = []
      room.distance = 0
      room.deadline = 0
      room.counted = false
      broadcast(room)
      return
    }

    case 'leave': {
      if (!room || !player) {
        ws.roomCode = null
        ws.playerId = null
        send(ws, { type: 'left' })
        return
      }
      if (player.offTimer) {
        clearTimeout(player.offTimer)
        player.offTimer = null
      }
      room.players = room.players.filter((p) => p.id !== player.id)
      if (room.hostId === player.id) {
        const heir = activePlayers(room)[0]
        room.hostId = heir ? heir.id : null
      }
      ws.roomCode = null
      ws.playerId = null

      if (room.players.length === 0) {
        clearRoundTimer(room)
        rooms.delete(room.code)
      } else {
        if (room.phase === 'answering') maybeReveal(room)
        broadcast(room)
      }
      send(ws, { type: 'left' })
      return
    }

    case 'chat': {
      // 弹幕：房间里的任何人随时能冒一句，飘个气泡，不留历史
      if (!room || !player) return sendError(ws, '你还没进房间')
      const now = Date.now()
      if (player.lastChatAt && now - player.lastChatAt < CHAT_GAP_MS) return // 刷屏的悄悄丢掉
      const text = String(msg.text ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_CHAT_LEN)
      if (!text) return
      player.lastChatAt = now
      touch(room)
      stats.chatSent()
      const payload = JSON.stringify({
        type: 'chat',
        id: crypto.randomUUID(),
        playerId: player.id,
        from: player.name,
        text,
      })
      for (const p of room.players) {
        if (p.ws && p.ws.readyState === 1) p.ws.send(payload)
      }
      return
    }

    case 'ping':
      send(ws, { type: 'pong' })
      return

    default:
      sendError(ws, '不懂这个操作')
  }
}

// ---------------------------------------------------------------- 连接
wss.on('connection', (ws) => {
  ws.roomCode = null
  ws.playerId = null

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }
    if (!msg || typeof msg.type !== 'string') return
    try {
      handleMessage(ws, msg)
    } catch (err) {
      console.error('[sync_web] handler error', err)
      sendError(ws, '服务器打了个嗝，再试一次')
    }
  })

  ws.on('close', () => {
    const room = ws.roomCode ? rooms.get(ws.roomCode) : null
    if (!room) return
    const player = room.players.find((p) => p.id === ws.playerId)
    if (!player) return
    // 这个人已经用新连接回来了，旧连接的关闭不能把他的 ws 抹掉，
    // 否则他从此收不到任何广播（表现为「别人交了我不更新」）。
    if (player.ws !== ws) return

    player.connected = false
    player.ws = null

    if (room.hostId === player.id) {
      const heir = activePlayers(room)[0]
      if (heir) room.hostId = heir.id
    }

    if (room.phase === 'answering') maybeReveal(room)
    broadcast(room)

    player.offTimer = setTimeout(() => {
      const still = room.players.find((p) => p.id === player.id)
      if (!still || still.connected) return
      room.players = room.players.filter((p) => p.id !== player.id)
      if (room.hostId === player.id) {
        const heir = activePlayers(room)[0]
        room.hostId = heir ? heir.id : null
      }
      if (room.players.length === 0) rooms.delete(room.code)
      else broadcast(room)
    }, OFF_KEEP_MS)
  })
})

setInterval(() => {
  const now = Date.now()
  for (const [code, room] of rooms) {
    if (now - room.touchedAt > ROOM_IDLE_MS && activePlayers(room).length === 0) {
      rooms.delete(code)
    }
  }
}, 5 * 60_000).unref?.()

server.listen(PORT, () => {
  console.log(`\n  RESONANCE · ${PROD ? '生产' : '开发'}模式`)
  console.log(`  http://localhost:${PORT}`)
  if (!STATS_TOKEN) console.log(`  访问统计（仅本机）：http://localhost:${PORT}/admin`)
  console.log('')
})

// 退出前把没落盘的统计写下去，并往 Supabase 推最后一次
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stats.save()
    if (statsBackup) {
      // 给远端请求留 3 秒，推完（或超时）再退
      statsBackup.pushNow().catch(() => {})
      setTimeout(() => process.exit(0), 3000)
    } else {
      process.exit(0)
    }
  })
}
