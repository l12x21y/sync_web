/**
 * 把本地的 data/stats.json 合并进 Supabase 的备份（一次性工具）。
 *
 * 用法（PowerShell，在项目根目录）：
 *   $env:SUPABASE_URL='https://xxxx.supabase.co'
 *   $env:SUPABASE_SERVICE_KEY='eyJ...'   # service_role，不是 anon
 *   node scripts/merge-stats-up.mjs           # 先预览，看数值对不对
 *   node scripts/merge-stats-up.mjs --write   # 确认后再真的写上去
 *
 * 合并口径：
 *   - totals / history 按天逐项相加（两侧都有 2026-11-01 时叠加）
 *   - people（昵称计数）相加；seen（去重指纹）取并集、时间戳取较大者
 *   - startedAt 取更早的，lastAt 取更晚的
 * 写完之后去 Render 点一次 Restart，新实例本地没文件，
 * 会自动从 Supabase 把合并后的数据拉回去接着记。
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const FILE = process.env.STATS_FILE || path.resolve('data/stats.json')
const TABLE = process.env.SUPABASE_STATS_TABLE || 'sync_stats'
const WRITE = process.argv.includes('--write')

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/+$/, '')
const KEY = process.env.SUPABASE_SERVICE_KEY || ''
if (!URL_ || !KEY) {
  console.error('缺环境变量：SUPABASE_URL / SUPABASE_SERVICE_KEY')
  process.exit(1)
}
if (!fs.existsSync(FILE)) {
  console.error(`本地没有统计文件：${FILE}`)
  process.exit(1)
}

const head = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
}

const local = JSON.parse(fs.readFileSync(FILE, 'utf8'))

// ---- 拉远端当前备份 ----
const getRes = await fetch(`${URL_}/rest/v1/${TABLE}?id=eq.main&select=payload&limit=1`, {
  headers: head,
})
if (!getRes.ok) {
  console.error(`读远端失败：HTTP ${getRes.status} ${(await getRes.text()).slice(0, 200)}`)
  process.exit(1)
}
const rows = await getRes.json()
const remote = rows?.[0]?.payload || null

// ---- 合并 ----
const KEYS = [
  'pv',
  'uv',
  'visits',
  'rooms',
  'joins',
  'games',
  'rounds',
  'chats',
  'players',
  'referral',
]
const addAll = (a, b) => {
  const out = { ...a }
  for (const k of KEYS) out[k] = (a[k] || 0) + (b[k] || 0)
  return out
}

function merge(a, b) {
  if (!a) return b
  if (!b) return a
  const history = { ...a.history }
  for (const [day, v] of Object.entries(b.history || {})) {
    history[day] = history[day] ? addAll(history[day], v) : v
  }
  const seen = { ...a.seen }
  for (const [fp, t] of Object.entries(b.seen || {})) {
    seen[fp] = Math.max(seen[fp] || 0, t)
  }
  const people = { ...a.people }
  for (const [n, c] of Object.entries(b.people || {})) {
    people[n] = (people[n] || 0) + c
  }
  return {
    ...a,
    startedAt: Math.min(a.startedAt || Infinity, b.startedAt || Infinity) || a.startedAt,
    lastAt: Math.max(a.lastAt || 0, b.lastAt || 0),
    totals: addAll(a.totals, b.totals),
    history,
    seen,
    people,
  }
}

const merged = merge(remote, local)

// ---- 预览 ----
const fmt = (o) => KEYS.map((k) => `${k}:${o?.[k] ?? 0}`).join(' ')
console.log('本地     :', fmt(local.totals))
console.log('远端备份 :', remote ? fmt(remote.totals) : '（空，还没有备份）')
console.log('合并结果 :', fmt(merged.totals))
console.log('按天明细 :', Object.keys(merged.history).join(', '))
console.log('昵称条数 :', Object.keys(merged.people || {}).length)

if (!WRITE) {
  console.log('\n（预览模式，还没写。确认数字没问题后加 --write 再跑一次）')
  process.exit(0)
}

// ---- 写回远端 ----
const putRes = await fetch(`${URL_}/rest/v1/${TABLE}?on_conflict=id`, {
  method: 'POST',
  headers: { ...head, Prefer: 'resolution=merge-duplicates' },
  body: JSON.stringify({
    id: 'main',
    payload: merged,
    updated_at: new Date().toISOString(),
  }),
})
if (!putRes.ok) {
  console.error(`写入失败：HTTP ${putRes.status} ${(await putRes.text()).slice(0, 200)}`)
  process.exit(1)
}
console.log('\n✅ 已把合并后的数据写进 Supabase（sync_stats / main）')
console.log('下一步：去 Render 点 Restart（或 Manual Deploy），新实例启动时')
console.log('本地没有统计文件，会自动从 Supabase 恢复这份合并数据接着记。')
