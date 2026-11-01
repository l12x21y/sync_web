/** merge-stats-up.mjs 的合并逻辑自测：mock PostgREST，验证预览/写入/合并口径 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { spawn } from 'node:child_process'

const PORT = 6401
const DATA_DIR = path.resolve('data-test')
const FILE = path.join(DATA_DIR, 'stats.json')
fs.rmSync(DATA_DIR, { recursive: true, force: true })
fs.mkdirSync(DATA_DIR, { recursive: true })

const localData = {
  startedAt: 100,
  lastAt: 900,
  totals: { pv: 15, uv: 5, visits: 5, rooms: 6, joins: 68, games: 6, rounds: 12, chats: 18, players: 74, referral: 5 },
  history: { '2026-11-01': { pv: 15, uv: 5, visits: 5, rooms: 6, joins: 68, games: 6, rounds: 12, chats: 18, players: 74, referral: 5 } },
  seen: { a: 100, b: 200 },
  people: { 阿真: 6, 玩家01: 4 },
}
fs.writeFileSync(FILE, JSON.stringify(localData))

const remoteData = {
  startedAt: 50,
  lastAt: 800,
  totals: { pv: 3, uv: 2, visits: 2, rooms: 1, joins: 4, games: 1, rounds: 2, chats: 3, players: 6, referral: 1 },
  history: { '2026-11-01': { pv: 3, uv: 2, visits: 2, rooms: 1, joins: 4, games: 1, rounds: 2, chats: 3, players: 6, referral: 1 } },
  seen: { a: 150, c: 300 },
  people: { 阿真: 1, 小满: 2 },
}

let stored = remoteData
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/rest/v1/sync_stats') {
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify([{ id: 'main', payload: stored }]))
    }
    if (req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      return req.on('end', () => {
        stored = JSON.parse(body).payload
        res.statusCode = 201
        res.end('[]')
      })
    }
  }
  res.statusCode = 404
  res.end()
})
await new Promise((r) => mock.listen(PORT, r))

const env = {
  ...process.env,
  SUPABASE_URL: `http://127.0.0.1:${PORT}`,
  SUPABASE_SERVICE_KEY: 'test',
  STATS_FILE: FILE,
}
const run = (args) =>
  new Promise((res) => {
    const p = spawn(process.execPath, ['scripts/merge-stats-up.mjs', ...args], { env })
    let out = ''
    p.stdout.on('data', (c) => (out += c))
    p.stderr.on('data', (c) => (out += c))
    p.on('close', () => res(out))
  })

let pass = 0
const ok = (cond, m) => {
  if (!cond) {
    console.error('FAIL:', m)
    process.exit(1)
  }
  pass++
  console.log('  ✓', m)
}

// 预览模式：不写
let out = await run([])
ok(/预览模式/.test(out), '不带 --write 是预览，不写远端')
ok(stored === remoteData || stored.totals.pv === remoteData.totals.pv, '预览模式没有改动远端')

// 写入
out = await run(['--write'])
ok(/已把合并后的数据写进/.test(out), '--write 真正写入')
const t = stored.totals
ok(t.pv === 18 && t.uv === 7 && t.players === 80 && t.joins === 72, `totals 逐项相加（pv=18 uv=7 players=80）`)
ok(stored.history['2026-11-01'].pv === 18, '按天明细相加')
ok(stored.people['阿真'] === 7 && stored.people['玩家01'] === 4 && stored.people['小满'] === 2, '昵称计数相加')
ok(stored.seen.a === 150 && stored.seen.b === 200 && stored.seen.c === 300, '指纹并集、时间戳取大')
ok(stored.startedAt === 50 && stored.lastAt === 900, 'startedAt 取早 / lastAt 取晚')

mock.close()
fs.rmSync(DATA_DIR, { recursive: true, force: true })
console.log(`\n${pass} 条断言全过`)
