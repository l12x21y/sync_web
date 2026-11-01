/**
 * 真流程截图：用 CDP 驱动无头 Chrome，分别按桌面（1440×900）和手机（390×844）
 * 走一遍完整对局，产出 shots/d-*.png 与 shots/m-*.png。
 * 前置：`node server.js` 已在跑。
 * 用法：`node test/shots.mjs`
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const APP = process.env.APP_URL || 'http://localhost:5173/'
const WS_URL = process.env.WS_URL || 'ws://localhost:5173/ws'
const OUT = path.resolve('shots')
const PORT = 9400 + Math.floor(Math.random() * 200)

fs.mkdirSync(OUT, { recursive: true })
const profile = path.join(os.tmpdir(), `sw-chrome-${Date.now()}`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------------ 群演（真实 ws 玩家）
function makeGuest(name) {
  const ws = new WebSocket(WS_URL)
  const g = { name, ws, room: null, id: null }
  g.send = (m) => ws.send(JSON.stringify(m))
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw))
    if (m.type === 'joined') {
      g.id = m.playerId
      g.room = m.room
    } else if (m.type === 'state') {
      g.room = m.room
    }
  })
  return g
}

// ------------------------------------------------------------------ CDP
function attach(wsUrl) {
  const ws = new WebSocket(wsUrl, { maxPayload: 512 * 1024 * 1024 })
  let seq = 0
  const pending = new Map()
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw))
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id)
      pending.delete(m.id)
      if (m.error) rej(new Error(m.error.message))
      else res(m.result)
    }
  })
  const opened = new Promise((r) => ws.on('open', r))
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, { res, rej })
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { ws, send, opened }
}

async function main() {
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let target = null
  for (let i = 0; i < 100 && !target; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
      target = await r.json()
    } catch {
      await sleep(150)
    }
  }
  if (!target) throw new Error('CDP 没起来')

  const cdp = attach(target.webSocketDebuggerUrl)
  await cdp.opened
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  const evalJs = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) {
      throw new Error(
        r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'eval error',
      )
    }
    return r.result.value
  }

  const waitFor = async (expr, timeout = 9000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const ok = await evalJs(`(()=>{ try { return !!(${expr}) } catch(e){ return false } })()`)
      if (ok) return true
      await sleep(120)
    }
    throw new Error(`等待超时: ${expr}`)
  }

  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
    console.log('  📸', name)
  }

  // 截图脚本里的轻量断言：失败只记一条 ✗，不中断整趟截图
  const failures = []
  const assert = (cond, msg) => {
    console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`)
    if (!cond) failures.push(msg)
  }
  const record = (label, value) => console.log(`  · ${label}: ${value}`)

  const typeInto = (selector, value) =>
    evalJs(`(()=>{
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return 'no-el'
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, ${JSON.stringify(value)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return el.value
    })()`)

  const clickText = (text) =>
    evalJs(`(()=>{
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(text)})
      if (!b) return 'no-btn'
      b.click()
      return 'clicked'
    })()`)

  async function flow({ prefix, width, height, dsf, mobile, guestNames }) {
    console.log(`\n  ── ${prefix} ${width}×${height} ──`)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: dsf,
      mobile,
    })
    // iPhone UA：让页面走手机分支，同时保留手机视口
    if (mobile) {
      await cdp.send('Emulation.setUserAgentOverride', {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
        acceptLanguage: 'zh-CN',
        platform: 'iPhone',
      })
    } else {
      await cdp.send('Emulation.setUserAgentOverride', {
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        acceptLanguage: 'zh-CN',
        platform: 'Win32',
      })
    }

    // 清掉上一轮留下的座位，保证从首页进
    await cdp.send('Page.navigate', { url: APP })
    // 等页面真的落到应用域名再动 localStorage（刚 navigate 时还是 about:blank 会报 SecurityError）
    await waitFor(`location.origin === ${JSON.stringify(new URL(APP).origin)}`)
    await evalJs('localStorage.clear()')
    await cdp.send('Page.reload', {})
    await waitFor(`document.querySelector('#nick')`)
    await sleep(500)
    await shot(`${prefix}-1-home`)

    await typeInto('#nick', '阿真')
    await sleep(150)
    await clickText('开一间')
    await waitFor(`document.querySelector('.code')`)
    const code = await evalJs(`document.querySelector('.code').textContent.trim()`)
    console.log('  房号', code)

    const guests = guestNames.map(makeGuest)
    await sleep(350)
    for (const g of guests) g.send({ type: 'join', code, name: g.name })
    const t0 = Date.now()
    while (Date.now() - t0 < 6000 && !guests.every((g) => g.room)) await sleep(80)

    await waitFor(`document.querySelectorAll('.row').length >= ${guests.length + 1}`)
    await sleep(500)
    // 房主设个题目，顺便验证题目块渲染（450ms 防抖后自动提交）
    await typeInto('.settings .field', '一种热带水果')
    await sleep(1100)
    await shot(`${prefix}-2-lobby`)

    await clickText('开始')
    await waitFor(`document.querySelector('.field--word')`)
    // 群演冒几句泡，弹幕气泡入镜（每条各占一条轨道，飘完才散）
    // 手机上群演只有 2 人，补一条房主这边的（点一下「发」验证真实输入路径）
    const chatter = [
      '我先想了个方向，都往水果想',
      '好，那我想热带的那种',
      '别提示太明显啦',
    ]
    for (let i = 0; i < chatter.length; i += 1) {
      if (guests[i]) guests[i].send({ type: 'chat', text: chatter[i] })
      await sleep(200)
    }
    if (guests.length < chatter.length) {
      await typeInto('.chatbar__input', '别提示太明显啦')
      await sleep(150)
      await evalJs(`document.querySelector('.chatbar').requestSubmit()`)
    }
    await sleep(2200)
    // 断言：多条气泡各自占一条轨道（同轨不重叠），且都有位移动画
    const bubbleInfo = await evalJs(`(() => {
      const bs = [...document.querySelectorAll('.dm__b')]
      return bs.map((b) => ({
        top: b.style.top,
        txt: b.querySelector('.dm__text')?.textContent || '',
        anim: getComputedStyle(b).animationName,
        x: Math.round(b.getBoundingClientRect().left),
      }))
    })()`)
    const vw = await evalJs('window.innerWidth')
    record('弹幕气泡数量', bubbleInfo.length)
    record('各气泡所在轨道 top', bubbleInfo.map((b) => b.top).join(' / '))
    record('气泡动画名', bubbleInfo.every((b) => b.anim === 'dm-fly') ? 'dm-fly ✓' : '异常')
    record('气泡横向位置', bubbleInfo.map((b) => b.x).join(' / '))
    const tops = bubbleInfo.map((b) => b.top)
    assert(bubbleInfo.length >= 2, `至少有 2 条气泡同时在场（实得 ${bubbleInfo.length}）`)
    assert(new Set(tops).size === tops.length, '每条气泡各占一条轨道，没有叠在一起')
    assert(
      bubbleInfo.every((b) => b.x < vw),
      '气泡都已经进入视口（在飞，而不是卡在门外）',
    )
    await shot(`${prefix}-3-play`)

    // 第一轮：不一致
    await typeInto('.field--word', '吃饭')
    await sleep(200)
    await clickText('交上去')
    await sleep(300)
    guests.forEach((g, i) => g.send({ type: 'submit', word: i === 0 ? '睡觉' : `词${i}` }))
    await waitFor(`document.querySelector('.groups')`)
    await sleep(900)
    await shot(`${prefix}-4-reveal`)

    // 第二轮：撞上
    await clickText('再写一次')
    await waitFor(`document.querySelector('.field--word')`)
    await sleep(500)
    await shot(`${prefix}-5-round2`)

    await typeInto('.field--word', '吃饭')
    await sleep(200)
    await clickText('交上去')
    await sleep(300)
    guests.forEach((g) => g.send({ type: 'submit', word: '吃饭' }))
    await waitFor(`document.querySelector('.hit__word')`)
    await sleep(1000)
    await shot(`${prefix}-6-hit`)

    // 对局记录
    await clickText('对局记录')
    await waitFor(`document.querySelector('.sheet__panel')`)
    await sleep(700)
    await shot(`${prefix}-8-log`)

    // 存图：手机上应当弹出「长按保存」浮层（a[download] 在 iOS/微信里无效）
    await clickText('存成图片')
    await sleep(600)
    const save = await evalJs(`(() => {
      const mask = document.querySelector('.savesheet')
      const img = mask?.querySelector('.savesheet__img')
      return {
        open: !!mask,
        src: img ? img.getAttribute('src')?.slice(0, 22) : null,
        w: img ? img.naturalWidth : 0,
        h: img ? img.naturalHeight : 0,
        tip: mask?.querySelector('.savesheet__tip')?.textContent || '',
      }
    })()`)
    record('存图浮层', save.open ? `已弹出 · ${save.tip}` : '未弹出')
    if (save.open) record('浮层里的图', `${save.src}… ${save.w}×${save.h}`)
    if (mobile) {
      assert(save.open, '手机点「存成图片」弹出长按保存浮层')
      assert(save.w > 600 && save.h > 300, `浮层里的图是完整尺寸（${save.w}×${save.h}）`)
      await shot(`${prefix}-8b-save`)
      const sheetBtns = await evalJs(
        `(() => {
          const bs = [...document.querySelectorAll('.savesheet .btn')]
          return {
            labels: bs.map((b) => b.textContent.trim()).join('/'),
            h: bs.map((b) => Math.round(b.getBoundingClientRect().height)),
            w: bs.map((b) => Math.round(b.getBoundingClientRect().width)),
            rowW: Math.round(document.querySelector('.savesheet__row').getBoundingClientRect().width),
          }
        })()`,
      )
      record('浮层按钮', `${sheetBtns.labels} · 高 ${sheetBtns.h.join('/')} 宽 ${sheetBtns.w.join('/')} / 行 ${sheetBtns.rowW}`)
      assert(sheetBtns.labels === '下载', `浮层里只有一个「下载」按钮（实得 ${sheetBtns.labels}）`)
      assert(sheetBtns.h[0] >= 40, `「下载」按钮高度正常（${sheetBtns.h[0]}px）`)
      assert(Math.abs(sheetBtns.w[0] - sheetBtns.rowW) <= 2, '「下载」占满整行宽度')
      // 没有「好了」了，点遮罩就收起
      await evalJs(`document.querySelector('.savesheet').click()`)
      await sleep(300)
      assert(!(await evalJs(`!!document.querySelector('.savesheet')`)), '点遮罩浮层收起')
    } else {
      assert(!save.open, '桌面走直接下载，不弹长按浮层')
    }

    await clickText('✕')
    await sleep(300)

    // 分享矩阵图：人是一列，轮次是一行（桌面那趟才导，造一份带「没交」的数据）
    if (prefix === 'd') {
      const dataUrl = await evalJs(`(async () => {
        const mod = await import('/src/share.js')
        const mk = (round, groups, { timedOut = false, penalty = 0, distance = 0 } = {}) =>
          ({ round, allSame: groups.length === 1 && groups[0].count >= 2, timedOut, penalty, distance, groups })
        const rounds = [
          mk(1, [
            { word: '吃饭', count: 2, names: ['阿真', '老周'] },
            { word: '睡觉', count: 2, names: ['小满', '大熊'] },
            { word: '散步', count: 1, names: ['阿吉'] },
          ], { penalty: 1000, distance: 1000 }),
          mk(2, [
            { word: '电影', count: 2, names: ['阿真', '小满'] },
            { word: '逛街', count: 2, names: ['老周', '阿吉'] },
          ], { timedOut: true, penalty: 1000, distance: 2000 }),
          mk(3, [
            { word: '海边', count: 4, names: ['阿真', '小满', '老周', '阿吉'] },
          ], { distance: 2000 }),
        ]
        return mod.buildImage(rounds, { players: 5, distance: 2000 }).toDataURL('image/png')
      })()`)
      fs.writeFileSync(
        path.join(OUT, `${prefix}-9-share.png`),
        Buffer.from(dataUrl.split(',')[1], 'base64'),
      )
      console.log('  📸', `${prefix}-9-share`)
    }

    guests.forEach((g) => g.ws.close())
    await sleep(200)
  }

  await flow({
    prefix: 'd',
    width: 1440,
    height: 900,
    dsf: 1,
    mobile: false,
    guestNames: ['小满', '老周', '阿吉', '大熊', '阿树', '豆子'],
  })

  await flow({
    prefix: 'm',
    width: 390,
    height: 844,
    dsf: 2,
    mobile: true,
    guestNames: ['小满', '老周'],
  })

  // 邀请链接：带 ?r= 打开应当直接落到「进别人的」并填好房号
  // 上一趟把 UA 改成了 iPhone，这里先拨回桌面，否则首页还是手机版
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    acceptLanguage: 'zh-CN',
    platform: 'Win32',
  })
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await cdp.send('Page.navigate', { url: `${APP}?r=4321` })
  await waitFor(`document.querySelector('#room-code')`)
  await sleep(600)
  const filled = await evalJs(`document.querySelector('#room-code').value`)
  const tab = await evalJs(`document.querySelector('.tab--on').textContent.trim()`)
  console.log('  邀请链接回填：', filled, '/ 当前页签：', tab)
  if (filled !== '4321' || tab !== '进别人的') throw new Error('邀请链接没有正确落到进别人的')
  await shot('d-7-invite')

  cdp.ws.close()
  chrome.kill()
  await sleep(400)
  try {
    fs.rmSync(profile, { recursive: true, force: true })
  } catch {
    /* 浏览器还没退干净，留着也无妨 */
  }
  console.log('\n  截图在', OUT)
  if (failures.length) {
    console.error(`  ${failures.length} 条断言未通过：`)
    failures.forEach((f) => console.error('   -', f))
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error('截图失败:', e.message)
  process.exit(1)
})
