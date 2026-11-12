/**
 * 保活脚本自测：起一个 mock 的 Supabase PostgREST，验证
 * 1) 正常时敲一次 select 并成功退出  2) 密钥错 / 表不存在时退出码为 1
 * 3) 没配环境变量时跳过且不报错  4) --render 会去叫醒 Render 的 /healthz
 */
import http from 'http'
import path from 'path'
import { spawn } from 'node:child_process'

const PORT = 6398
const BASE = `http://127.0.0.1:${PORT}`
const seen = { paths: [], heads: [] }
let mode = 'ok' // ok | unauthorized | missing-table

const mock = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  seen.paths.push(`${url.pathname}${url.search}`)
  seen.heads.push(req.headers)

  if (url.pathname === '/healthz') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, rooms: 0, uptime: 12 }))
    return
  }
  if (url.pathname === '/rest/v1/sync_stats') {
    if (mode === 'unauthorized') {
      res.statusCode = 401
      res.end('{"message":"Invalid API key"}')
      return
    }
    if (mode === 'missing-table') {
      res.statusCode = 404
      res.end('{"code":"PGRST205","message":"Could not find the table"}')
      return
    }
    res.setHeader('Content-Type', 'application/json')
    res.end('[{"id":"main"}]')
    return
  }
  res.statusCode = 404
  res.end('{}')
})
await new Promise((r) => mock.listen(PORT, r))

const fail = (m) => {
  console.error('FAIL:', m)
  mock.close()
  process.exit(1)
}
const ok = (m) => console.log('  ✓', m)

/** 起一次 keepalive.mjs，回收退出码与全部输出 */
function run(env, args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/keepalive.mjs', ...args], {
      cwd: path.resolve('.'),
      env: {
        ...process.env,
        SUPABASE_URL: '',
        SUPABASE_SERVICE_KEY: '',
        RENDER_URL: '',
        ...env,
      },
    })
    const chunks = []
    child.stdout.on('data', (c) => chunks.push(c))
    child.stderr.on('data', (c) => chunks.push(c))
    child.on('close', (code) =>
      resolve({ code, out: Buffer.concat(chunks).toString('utf8') }),
    )
  })
}

const reset = () => {
  seen.paths = []
  seen.heads = []
}

// ---------- 1. 正常：应该精准地敲一次 select ----------
mode = 'ok'
reset()
let r = await run({ SUPABASE_URL: BASE, SUPABASE_SERVICE_KEY: 'test-key' })
if (r.code !== 0) fail(`正常情况退出码应为 0，实际 ${r.code}\n${r.out}`)
const hit = seen.paths.filter((p) => p.startsWith('/rest/v1/sync_stats'))
if (hit.length !== 1) fail(`应恰好请求 1 次 sync_stats，实际 ${hit.length} 次：${seen.paths}`)
if (hit[0] !== '/rest/v1/sync_stats?select=id&limit=1') fail(`查询串不对：${hit[0]}`)
if (seen.heads[0].apikey !== 'test-key') fail('没带 apikey 头')
ok(`正常：一次 select 后退出 0（${hit[0]}）`)

// ---------- 2. 密钥错 ----------
mode = 'unauthorized'
reset()
r = await run({ SUPABASE_URL: BASE, SUPABASE_SERVICE_KEY: 'bad' })
if (r.code !== 1) fail(`401 时退出码应为 1，实际 ${r.code}\n${r.out}`)
if (!r.out.includes('401')) fail(`401 时应提示状态码\n${r.out}`)
ok('401：退出 1，提示钥匙不对')

// ---------- 3. 表不存在 ----------
mode = 'missing-table'
reset()
r = await run({ SUPABASE_URL: BASE, SUPABASE_SERVICE_KEY: 'test-key' })
if (r.code !== 1) fail(`404 时退出码应为 1，实际 ${r.code}\n${r.out}`)
if (!r.out.includes('404')) fail(`404 时应提示状态码\n${r.out}`)
ok('404：退出 1，提示建表')

// ---------- 4. 没配环境变量：跳过，不算失败 ----------
reset()
r = await run({})
if (r.code !== 0) fail(`缺 env 时应退出 0（跳过），实际 ${r.code}\n${r.out}`)
if (seen.paths.length !== 0) fail(`缺 env 时不该发请求，实际 ${seen.paths}`)
if (!r.out.includes('跳过')) fail(`缺 env 时应说明跳过\n${r.out}`)
ok('缺 env：不发请求，退出 0 并说明跳过')

// ---------- 5. --render 顺带叫醒实例 ----------
mode = 'ok'
reset()
r = await run({ SUPABASE_URL: BASE, SUPABASE_SERVICE_KEY: 'test-key' }, ['--render', BASE])
if (r.code !== 0) fail(`--render 正常时退出码应为 0，实际 ${r.code}\n${r.out}`)
if (!seen.paths.includes('/healthz')) fail(`没请求 /healthz：${seen.paths}`)
if (!r.out.includes('已醒')) fail(`应提示 Render 已醒\n${r.out}`)
ok('--render：额外请求 /healthz，不影响退出码')

mock.close()
console.log('\n保活脚本自测全过')
