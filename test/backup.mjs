/**
 * 备份链路自测：起一个 mock 的 Supabase PostgREST，
 * 验证 1) 启动 15s 内推送 upsert  2) 本地无文件时能从远端恢复。
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { spawn } from 'node:child_process'
import crypto from 'crypto'

const MOCK_PORT = 6399
const DATA_DIR = path.resolve('data-test')
const STATS_FILE = path.join(DATA_DIR, 'stats.json')
const seen = { posts: [], gets: 0 }

const mock = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/rest/v1/sync_stats') {
    if (req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        seen.posts.push(JSON.parse(body))
        res.setHeader('Preference-Applied', 'resolution=merge-duplicates')
        res.statusCode = 201
        res.end('[]')
      })
      return
    }
    if (req.method === 'GET') {
      seen.gets += 1
      // 只有 mock 里有「上次的备份」时才返回
      if (seen.remote) {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify([{ id: 'main', payload: seen.remote }]))
      } else {
        res.end('[]')
      }
      return
    }
  }
  res.statusCode = 404
  res.end('{}')
})
await new Promise((r) => mock.listen(MOCK_PORT, r))

const fail = (m) => {
  console.error('FAIL:', m)
  process.exit(1)
}
const ok = (m) => console.log('  ✓', m)

// ---------- 场景 1：本地已有文件 → 恢复应跳过，15s 后应推送 ----------
fs.rmSync(DATA_DIR, { recursive: true, force: true })
fs.mkdirSync(DATA_DIR, { recursive: true })
fs.writeFileSync(STATS_FILE, JSON.stringify({ totals: { pv: 5 }, history: {}, startedAt: 1 }))

const env = {
  ...process.env,
  PORT: '5299',
  STATS_FILE,
  SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  SUPABASE_SERVICE_KEY: 'test-key',
}
const srv = spawn(process.execPath, ['server.js'], { env, stdio: 'ignore' })
// 首次推送在启动 15s 后，轮询等到它发生（最多 25s）
const t0 = Date.now()
while (seen.posts.length < 1 && Date.now() - t0 < 25_000) await new Promise((r) => setTimeout(r, 300))
if (seen.gets !== 0) fail(`本地有文件就不该去远端恢复（gets=${seen.gets}）`)
ok('本地有文件：启动时不做远端恢复')
if (seen.posts.length < 1) fail('25s 内没有发生首次推送')
const pushed = seen.posts[0]
if (pushed.id !== 'main' || pushed.payload?.totals?.pv !== 5) fail('推送的 payload 不对')
ok(`启动 15s 后自动推送（用时 ${Math.round((Date.now() - t0) / 1000)}s，payload 正确）`)

// 把进程杀掉。Windows 上 kill(SIGTERM) 是强杀、子进程收不到信号，
// 「退出前兜底推送」只能在 Linux（Render）上验证；这里跳过。
srv.kill('SIGKILL')

// ---------- 场景 2：本地无文件 + 远端有备份 → 启动时应恢复 ----------
seen.remote = { totals: { pv: 42 }, history: {}, startedAt: 9 }
seen.posts = []
fs.rmSync(STATS_FILE, { force: true })

const srv2 = spawn(process.execPath, ['server.js'], { env, stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 4000))
if (!fs.existsSync(STATS_FILE)) fail('远端有备份但本地没恢复出文件')
const restored = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'))
if (restored.totals?.pv !== 42) fail(`恢复的数据不对：${restored.totals?.pv}`)
ok('本地无文件：启动时从远端恢复备份（pv=42）')

srv2.kill('SIGKILL')
mock.close()
fs.rmSync(DATA_DIR, { recursive: true, force: true })
console.log('\n备份链路自测全过')
process.exit(0)
