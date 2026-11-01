/**
 * 统计数据的远端备份（Supabase，可选）。
 *
 * Render 免费档的磁盘是临时的，实例重建 data/stats.json 就没了；
 * 这里把整份统计 JSON 定期 upsert 到 Supabase 的一张表里：
 *   - 启动时本地没有文件 → 先从远端拉回来，接着上次的数继续记
 *   - 启动 15 秒后推第一次，之后每 6 小时推一次（upsert 幂等，多推无害）
 *   - 进程退出前再推一次
 *
 * 需要的环境变量：
 *   SUPABASE_URL          项目地址，如 https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY  service_role 密钥（只在服务端用，别写进前端/仓库）
 * 可选：
 *   SUPABASE_STATS_TABLE  表名，默认 sync_stats
 * 建表 SQL 见 README「访问统计」一节。
 */
import fs from 'fs'
import path from 'path'

const ROW_ID = 'main'
const PUSH_FIRST_MS = 15_000
const PUSH_INTERVAL_MS = 6 * 60 * 60_000

function conf() {
  return {
    url: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    key: process.env.SUPABASE_SERVICE_KEY || '',
    table: process.env.SUPABASE_STATS_TABLE || 'sync_stats',
  }
}

export function backupConfigured() {
  const { url, key } = conf()
  return Boolean(url && key)
}

function headers(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }
}

/** 把本地 stats 文件整份推到远端（幂等 upsert） */
export async function pushNow({ file, ensure = null, log = console } = {}) {
  const { url, key, table } = conf()
  if (!url || !key) return false
  // 实例刚启动还没发生过任何事件时，文件还不存在——先落一次盘
  if (!fs.existsSync(file)) ensure?.()
  if (!fs.existsSync(file)) {
    log.log?.('[backup] 本地还没有统计文件，跳过本次推送')
    return false
  }
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'))
  const res = await fetch(`${url}/rest/v1/${table}?on_conflict=id`, {
    method: 'POST',
    headers: { ...headers(key), Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ id: ROW_ID, payload, updated_at: new Date().toISOString() }),
  })
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200)
    throw new Error(`HTTP ${res.status} ${detail}`)
  }
  log.log?.(`[backup] 已推送到 Supabase（${table}）`)
  return true
}

/** 本地没有统计文件时（Render 重建实例），从远端把上次备份拉回来 */
export async function restoreFromRemote({ file, log = console } = {}) {
  const { url, key, table } = conf()
  if (!url || !key || fs.existsSync(file)) return false
  try {
    const res = await fetch(
      `${url}/rest/v1/${table}?id=eq.${ROW_ID}&select=payload&limit=1`,
      { headers: headers(key) },
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const rows = await res.json()
    const payload = rows?.[0]?.payload
    if (!payload || typeof payload !== 'object') return false
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(payload, null, 2))
    log.log?.('[backup] 本地无统计文件，已从 Supabase 恢复上次的备份')
    return true
  } catch (err) {
    log.warn?.('[backup] 恢复失败（从零开始记）：', err.message)
    return false
  }
}

/** 启动定期推送；返回 { pushNow } 供退出前再推一次 */
export function startBackup({ file, ensure = null, log = console } = {}) {
  if (!backupConfigured()) return null

  const attempt = async (label) => {
    try {
      await pushNow({ file, ensure, log })
    } catch (err) {
      log.warn?.(`[backup] ${label}推送失败：`, err.message)
    }
  }

  const timer = setTimeout(() => attempt('启动后首次'), PUSH_FIRST_MS)
  timer.unref?.()
  const loop = setInterval(() => attempt('定时'), PUSH_INTERVAL_MS)
  loop.unref?.()

  return { pushNow: () => pushNow({ file, log }) }
}
