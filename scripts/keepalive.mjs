/**
 * Supabase 保活：让免费项目别因为「一周没什么活动」被自动暂停。
 *
 * 官方口径（https://supabase.com/docs/guides/platform/paused-projects）：
 * 免费计划的项目在过去一周用户数据库活动太少就会被暂停；「每天几次数据库请求」
 * 就足够避开自动暂停。所以这里要打**真的进 Postgres 的查询**，不是随便 ping 一下域名
 * —— 边缘健康检查不算数据库活动。
 *
 * 两条路，能用的都走：
 *   1. 直连：配了 SUPABASE_URL + SUPABASE_SERVICE_KEY 就查一次 sync_stats（最可靠）
 *   2. 兜底：给了 Render 地址就请求 /healthz 把睡着的实例叫起来；实例醒来 15 秒后会
 *      自己把统计推上去（server/backup.js），同样产生数据库活动。不需要任何密钥。
 *
 * 用法（PowerShell，项目根目录）：
 *   $env:SUPABASE_URL='https://xxxx.supabase.co'
 *   $env:SUPABASE_SERVICE_KEY='sb_secret_...'
 *   node scripts/keepalive.mjs
 *   node scripts/keepalive.mjs --render https://sync-web-trh2.onrender.com
 *
 * --render <url>  或环境变量 RENDER_URL；叫不醒不算失败（除非直连也没配）。
 *
 * 定时执行见 .github/workflows/keepalive.yml（每天两次、UTC）。
 * 退出码：0 = 本次完成（含「什么都没配、跳过」）；1 = 请求失败，需要人看。
 */
const TABLE = process.env.SUPABASE_STATS_TABLE || 'sync_stats'
const URL_ = (process.env.SUPABASE_URL || '').replace(/\/+$/, '')
const KEY = process.env.SUPABASE_SERVICE_KEY || ''
const RENDER = (argValue('--render') || process.env.RENDER_URL || '').replace(/\/+$/, '')
const DB_TIMEOUT_MS = 30_000
const RENDER_TIMEOUT_MS = 90_000

/** 取 --flag value / --flag=value 的值 */
function argValue(flag) {
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag) return argv[i + 1] || ''
    if (argv[i].startsWith(`${flag}=`)) return argv[i].slice(flag.length + 1)
  }
  return ''
}

let status = 0

// ---------------------------------------------------------------- 1. 直连数据库
const dbReady = Boolean(URL_ && KEY)
if (!dbReady) {
  // CI 里没配 secrets 时要看得见，但又不必天天发失败邮件
  const msg = '缺 SUPABASE_URL / SUPABASE_SERVICE_KEY，跳过直连；配好仓库 secrets 才会真的查库'
  console.log(`::warning::${msg}`)
  console.log(msg)
} else {
  const t0 = Date.now()
  try {
    const res = await fetch(`${URL_}/rest/v1/${TABLE}?select=id&limit=1`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    })
    const ms = Date.now() - t0
    if (res.ok) {
      console.log(`✅ 已敲一次数据库（表 ${TABLE}）：HTTP ${res.status}，${ms}ms`)
    } else {
      const detail = (await res.text()).slice(0, 300)
      status = 1
      if (res.status === 401 || res.status === 403) {
        console.error(
          `❌ 钥匙不对（HTTP ${res.status}）：SUPABASE_SERVICE_KEY 要用 service_role / sb_secret_，不是 publishable。${detail}`,
        )
      } else if (res.status === 404) {
        console.error(
          `❌ 表 ${TABLE} 不存在或 URL 不对（HTTP 404）：去 SQL Editor 建表，见 TECHNICAL.md「Supabase 备份」。${detail}`,
        )
      } else {
        console.error(`❌ 请求失败：HTTP ${res.status}，${ms}ms，${detail}`)
      }
    }
  } catch (err) {
    status = 1
    console.error(`❌ 连不上 Supabase：${err.message}`)
  }
}

// ---------------------------------------------------------------- 2. 唤醒 Render
if (RENDER) {
  const target = `${RENDER}/healthz`
  const t1 = Date.now()
  try {
    const res = await fetch(target, { signal: AbortSignal.timeout(RENDER_TIMEOUT_MS) })
    if (res.ok) {
      const body = await res.json().catch(() => ({}))
      console.log(
        `✅ Render 实例已醒：HTTP ${res.status}，${Date.now() - t1}ms，uptime ${body.uptime ?? '?'}s`,
      )
    } else {
      // 服务活着但健康检查不过；直连还成功的话不必报警
      console.warn(`⚠️ Render /healthz 返回 HTTP ${res.status}`)
      if (!dbReady) status = 1
    }
  } catch (err) {
    console.warn(`⚠️ Render 没叫醒（${err.message}）`)
    // 只剩这一条路时，叫不醒就等于这次保活落空了
    if (!dbReady) status = 1
  }
}

if (!dbReady && !RENDER) {
  console.log('没配任何目标（Supabase 密钥 / Render 地址），本次什么都没做')
}

// 不调 process.exit：CI 里 stdout 是管道，硬退出可能把上面的日志截掉
process.exitCode = status
