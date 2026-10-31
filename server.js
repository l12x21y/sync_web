import express from 'express'
import http from 'http'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { WebSocketServer } from 'ws'
import { normalizeWord, displayWord } from './shared/normalize.js'

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
const OFF_KEEP_MS = 90_000
const ROOM_IDLE_MS = 30 * 60_000

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
  const active = activePlayers(room)
  const groups = new Map()

  for (const p of active) {
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

  return {
    allSame: list.length === 1 && list[0].count >= 2,
    groups: list,
    round: room.round,
    answered: list.reduce((n, g) => n + g.count, 0),
    distinct: list.length,
    missing: active.filter((p) => !room.answers.has(p.id)).map((p) => p.name),
  }
}

function maybeReveal(room) {
  if (room.phase !== 'answering') return false
  const active = activePlayers(room)
  if (active.length < 2) return false
  if (!active.every((p) => room.answers.has(p.id))) return false

  room.phase = 'reveal'
  room.reveal = computeReveal(room)
  room.rounds.push({
    round: room.round,
    allSame: room.reveal.allSame,
    groups: room.reveal.groups.map((g) => ({
      word: g.word,
      count: g.count,
      names: g.names.slice(),
    })),
  })
  return true
}

function beginRound(room) {
  room.round += 1
  room.answers.clear()
  room.reveal = null
  room.phase = 'answering'
}

// ---------------------------------------------------------------- 下发
function publicRoom(room) {
  const active = activePlayers(room)
  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    round: room.round,
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
      if (ws.roomCode) return sendError(ws, '你已经在房间里了')
      const name = cleanName(msg.name)
      if (!name) return sendError(ws, '先起个名字')
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
      if (ws.roomCode) return sendError(ws, '你已经在房间里了')
      const code = String(msg.code ?? '').trim()
      const name = cleanName(msg.name)
      if (!name) return sendError(ws, '先起个名字')
      const r = rooms.get(code)
      if (!r) return sendError(ws, '房号不对，或者房间已经散了')
      if (r.phase !== 'lobby') return sendError(ws, '这局已经开始了，等结束再来')
      if (activePlayers(r).length >= MAX_PLAYERS)
        return sendError(ws, `最多 ${MAX_PLAYERS} 个人`)
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
      if (!r) return sendError(ws, '房间没了，重新开一局吧')
      const p = r.players.find((x) => x.id === msg.playerId)
      if (!p) return sendError(ws, '座位没了，重新进吧')
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

    case 'start': {
      if (!room || !player) return sendError(ws, '先开个房间')
      if (room.hostId !== player.id) return sendError(ws, '只有房主能开始')
      if (room.phase !== 'lobby') return sendError(ws, '这局已经开始了')
      if (activePlayers(room).length < 2) return sendError(ws, '至少两个人才能玩')
      room.round = 0
      room.rounds = []
      beginRound(room)
      broadcast(room)
      return
    }

    case 'submit': {
      if (!room || !player) return sendError(ws, '先开个房间')
      if (room.phase !== 'answering') return sendError(ws, '现在不是作答时间')
      if (room.answers.has(player.id)) return sendError(ws, '这一轮你已经交了')
      const word = displayWord(String(msg.word ?? ''))
      if (!word) return sendError(ws, '写一个词')
      if ([...word].length > MAX_WORD_LEN) return sendError(ws, `最多 ${MAX_WORD_LEN} 个字`)
      if (!normalizeWord(word)) return sendError(ws, '写个正经的词')
      room.answers.set(player.id, word)
      maybeReveal(room)
      broadcast(room)
      return
    }

    case 'next': {
      if (!room || !player) return sendError(ws, '先开个房间')
      if (room.hostId !== player.id) return sendError(ws, '只有房主能推进')
      if (room.phase !== 'reveal') return sendError(ws, '结果还没出来')
      if (room.reveal?.allSame) return sendError(ws, '已经撞上了，开新的一局吧')
      beginRound(room)
      broadcast(room)
      return
    }

    case 'again': {
      if (!room || !player) return sendError(ws, '先开个房间')
      if (room.hostId !== player.id) return sendError(ws, '只有房主能再来一局')
      room.phase = 'lobby'
      room.round = 0
      room.answers.clear()
      room.reveal = null
      room.rounds = []
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
        rooms.delete(room.code)
      } else {
        if (room.phase === 'answering') maybeReveal(room)
        broadcast(room)
      }
      send(ws, { type: 'left' })
      return
    }

    case 'ping':
      send(ws, { type: 'pong' })
      return

    default:
      sendError(ws, '不认识这个操作')
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
  console.log(`\n  同词相见 · ${PROD ? '生产' : '开发'}模式`)
  console.log(`  http://localhost:${PORT}\n`)
})
