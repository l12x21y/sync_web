/**
 * Supabase 保活：让免费项目别因为「一周没什么活动」被自动暂停。
 *
 * 官方口径（https://supabase.com/docs/guides/platform/paused-projects）：
 * 免费计划的项目在过去一周用户数据库活动太少就会被暂停；「每天几次数据库请求」
 * 就足够避开自动暂停。所以这里要打**真的进 Postgres 的查询**，不是随便 ping 一下域名
 * —— 边缘健康检查不算数据库活动。
 *
 * 用法（PowerShell，项目根目录）：
 *   $env:SUPABASE_URL='https://xxxx.supabase.co'
 *   $env:SUPABASE_SERVICE_KEY='sb_secret_...'
 *   node scripts/keepalive.mjs
 *   node scripts/keepalive.mjs --render https://sync-web-trh2.onrender.com
 *
 * --render <url>  顺带请求一次 /healthz，把睡着的 Render 免费实例叫起来
 *                 （醒着的实例才会按 6 小时节奏把统计推上去）。叫不醒不算失败。
 *
 * 定时执行见 .github/workflows/keepalive.yml（每天两次、UTC）。
 * 退出码：0 = 本次完成（含「没配环境变量、跳过」）；1 = 请求失败，需要人看。
 */
const TABLE = process.env.SUPABASE_STATS_TABLE || 'sync_stats'
const URL_ = (process.env.SUPABASE_URL || '').replace(/\/+$/, '')
const KEY = process.env.SUPABASE_SERVICE_KEY || ''
const RENDER = argValue('--render') || process.env.RENDER_URL || ''
const DB_TIMEOUT_MS = 30_000

/** 取 --flag value / --flag=value 的值 */
function argValue(flag) {
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag) return argv[i + 1] || ''
    if (argv[i].startsWith(`${flag}=`)) return argv[i].slice(flag.length + 1)
  }
  return ''
}

if (!URL_ || !KEY) {
  // CI 里没配 secrets 时要看得见，但又不必天天发失败邮件
  const msg = '缺 SUPABASE_URL / SUPABASE_SERVICE_KEY，本次跳过（配好仓库 secrets 才会真的请求）'
  console.log(`::warning::${msg}`)
  console.log(msg)
  process.exit(0)
}

const head = { apikey: KEY, Authorization: `Bearer ${KEY}` }

// ---------------------------------------------------------------- 数据库
const t0 = Date.now()
let status = 0
try {
  const res = await fetch(`${URL_}/rest/v1/${TABLE}?select=id&limit=1`, {
    headers: head,
    signal: AbortSignal.timeout(DB_TIMEOUT_MS),
  })
  const ms = Date.now() - t0
  if (res.ok) {
    console.log(`✅ 已敲一次数据库（表 ${TABLE}）：HTTP ${res.status}，${ms}ms`)
  } else {
    const detail = (await res.text()).slice(0, 300)
    status = 1
    if (res.status === 401 || res.status === 403) {
      console.error(`❌ 钥匙不对（HTTP ${res.status}）：SUPABASE_SERVICE_KEY 要用 service_role / sb_secret_，不是 publishable。${detail}`)
    } else if (res.status === 404) {
      console.error(`❌ 表 ${TABLE} 不存在或 URL 不对（HTTP 404）：去 SQL Editor 建表，见 TECHNICAL.md「Supabase 备份」。${detail}`)
    } else {
      console.error(`❌ 请求失败：HTTP ${res.status}，${ms}ms，${detail}`)
    }
  }
} catch (err) {
  status = 1
  console.error(`❌ 连不上 Supabase：${err.message}`)
}

// ---------------------------------------------------------------- Render 唤醒
if (RENDER) {
  const target = `${RENDER.replace(/\/+$/, '')}/healthz`
  const t1 = Date.now()
  try {
    const res = await fetch(target, { signal: AbortSignal.timeout(90_000) })
    if (res.ok) {
      const body = await res.json().catch(() => ({}))
      console.log(`✅ Render 实例已醒：HTTP ${res.status}，${Date.now() - t1}ms，uptime ${body.uptime ?? '?'}s`)
    } else {
      console.warn(`⚠️ Render /healthz 返回 HTTP ${res.status}（不影响数据库保活）`)
    }
  } catch (err) {
    console.warn(`⚠️ Render 没叫醒（${err.message}），不影响数据库保活`)
  }
}

// 不调 process.exit：CI 里 stdout 是管道，硬退出可能把上面的日志截掉
process.exitCode = status
