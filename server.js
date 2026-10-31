import express from 'express'
import http from 'http'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { WebSocketServer } from 'ws'
import { normalizeWord, displayWord } from './shared/normalize.js'
import { PER_ROUND_M } from './shared/distance.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROD = process.argv.includes('--prod') || process.env.NODE_ENV === 'production'
const PORT = Number(process.env.PORT || 5173)

// ---------------------------------------------------------------- 服务器
const app = express()
const server = http.createServer(app)

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) })
})

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
  console.log(`  http://localhost:${PORT}\n`)
})
