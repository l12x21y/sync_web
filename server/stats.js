/**
 * 访问统计：轻量、无数据库依赖。
 *
 * - 数据落在一个 JSON 文件里（默认 <项目>/data/stats.json），每次有变化后
 *   延迟 2 秒合并写入；进程退出时再兜底写一次。
 * - 只记聚合量，不存 IP、不存 UA 原文：访客用「IP+UA 的 sha256 截断」当
 *   匿名指纹去重，文件里出现不了原始标识。
 * - 每日 UV 在当天实时算；跨天之后沿用记下来的数（不再重算）。
 * - 环境变量 STATS_FILE 改路径；STATS_DISABLE=1 整体关掉。
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const DAY_MS = 24 * 60 * 60 * 1000
const KEEP_DAYS = 120 // 按天明细保留多久
const FLUSH_MS = 2000
const SESSION_MS = 30 * 60 * 1000

function dayKey(t = Date.now()) {
  return new Date(t).toISOString().slice(0, 10) // UTC 日期，够用了
}

function freshDays() {
  return {
    pv: 0, // 页面打开次数
    uv: 0, // 当天独立访客
    visits: 0, // 会话数
    rooms: 0, // 建房数
    joins: 0, // 通过房号进房的人数
    games: 0, // 跑完一局（对上了）
    rounds: 0, // 轮数
    chats: 0, // 弹幕条数
    players: 0, // 落座人次
    referral: 0, // 带 ?r= 打开的次数
  }
}

function freshTotals() {
  return {
    pv: 0,
    uv: 0,
    visits: 0,
    rooms: 0,
    joins: 0,
    games: 0,
    rounds: 0,
    chats: 0,
    players: 0,
    referral: 0,
  }
}

function createStats({ file, disabled = false, log = console }) {
  let data = {
    startedAt: Date.now(),
    totals: freshTotals(),
    history: {}, // { '2026-11-01': { pv, uv, ... } }
    seen: {}, // 指纹 -> 最后一次出现时间（只用来判 UV / 会话）
    people: {}, // 昵称 -> 出现次数
    lastAt: 0,
  }
  let timer = null
  let dirty = false

  if (!disabled && file) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
      data = {
        ...data,
        ...raw,
        totals: { ...freshTotals(), ...(raw.totals || {}) },
        history: raw.history || {},
        seen: raw.seen || {},
        people: raw.people || {},
      }
    } catch {
      // 没有旧数据，或者文件坏了：从零开始
    }
  }

  function save() {
    if (disabled || !file) return
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify({ ...data, savedAt: Date.now() }, null, 2))
    } catch (err) {
      log.warn?.('[stats] 写入失败：', err.message)
    }
  }

  function schedule() {
    dirty = true
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      if (dirty) {
        dirty = false
        save()
      }
    }, FLUSH_MS)
    timer.unref?.()
  }

  function bucket(day = dayKey()) {
    if (!data.history[day]) {
      data.history[day] = freshDays()
      const cutoff = dayKey(Date.now() - KEEP_DAYS * DAY_MS)
      for (const k of Object.keys(data.history)) if (k < cutoff) delete data.history[k]
    }
    return data.history[day]
  }

  /** 匿名指纹：IP + UA 截断哈希，不可逆，只用于去重 */
  function fingerprint(ip, ua) {
    return crypto.createHash('sha256').update(`${ip || ''}|${ua || ''}`).digest('hex').slice(0, 16)
  }

  /** 一次页面打开 */
  function pageview({ ip, ua, referer = '', referral = false }) {
    const now = Date.now()
    const fp = fingerprint(ip, ua)
    const day = dayKey(now)
    const b = bucket(day)

    data.totals.pv += 1
    b.pv += 1
    if (referral) {
      data.totals.referral += 1
      b.referral += 1
    }

    const firstVisitor = !data.seen[fp]
    const lastSeen = data.seen[fp] || 0
    if (firstVisitor) data.totals.uv += 1
    if (firstVisitor || now - lastSeen > SESSION_MS) {
      data.totals.visits += 1
      b.visits += 1
    }
    data.seen[fp] = now

    // 当日 UV：当天第一次出现才算
    const todayKey = `_uv:${fp}`
    if (!data.seen[todayKey]) {
      data.seen[todayKey] = now
      b.uv += 1
    }

    data.lastAt = now
    if (referer) b.lastReferer = String(referer).slice(0, 120)
    schedule()
    return fp
  }

  /** 有人落座（建房 / 进房） */
  function playerSeated(name, { created = false, joined = false } = {}) {
    const b = bucket()
    data.totals.players += 1
    b.players += 1
    if (created) {
      data.totals.rooms += 1
      b.rooms += 1
    }
    if (joined) {
      data.totals.joins += 1
      b.joins += 1
    }
    const n = String(name || '').trim()
    if (n) data.people[n] = (data.people[n] || 0) + 1
    data.lastAt = Date.now()
    schedule()
  }

  /** 一轮揭晓 */
  function roundDone() {
    data.totals.rounds += 1
    bucket().rounds += 1
    schedule()
  }

  /** 一局对上了 */
  function gameDone() {
    data.totals.games += 1
    bucket().games += 1
    schedule()
  }

  function chatSent() {
    data.totals.chats += 1
    bucket().chats += 1
    schedule()
  }

  /** 给后台看的汇总 */
  function summary({ days = 14 } = {}) {
    const series = []
    for (let i = days - 1; i >= 0; i -= 1) {
      const k = dayKey(Date.now() - i * DAY_MS)
      const b = data.history[k] || {}
      series.push({
        day: k,
        pv: b.pv || 0,
        uv: b.uv || 0,
        visits: b.visits || 0,
        rooms: b.rooms || 0,
        games: b.games || 0,
      })
    }
    const topNames = Object.entries(data.people || {})
      .sort((a, c) => c[1] - a[1])
      .slice(0, 12)
      .map(([name, count]) => ({ name, count }))
    return {
      startedAt: data.startedAt,
      lastAt: data.lastAt,
      today: data.history[dayKey()] || freshDays(),
      totals: data.totals,
      series,
      topNames,
      recent: Object.entries(data.history)
        .sort((a, c) => (a[0] < c[0] ? 1 : -1))
        .slice(0, 30)
        .map(([day, v]) => ({ day, ...v })),
    }
  }

  return {
    pageview,
    playerSeated,
    roundDone,
    gameDone,
    chatSent,
    summary,
    save,
    fingerprint,
    get data() {
      return data
    },
  }
}

export { createStats, dayKey }
