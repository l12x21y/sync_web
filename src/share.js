/**
 * 把一整局的记录（服务端下发的 room.rounds）变成能发出去的东西：
 * 一段文字，或者一张矩阵图——人是一列，轮次是一行。
 */

/** 每轮展开成「谁写了什么」，同词的人排在一起 */
function expandRound(round) {
  const rows = []
  for (const g of round.groups || []) {
    for (const name of g.names || []) rows.push({ name, word: g.word })
  }
  return rows
}

export function buildText(rounds, meta) {
  const lines = []
  lines.push('共振｜这一局')
  lines.push('')
  lines.push(`${meta.players} 个人，${rounds.length} 次对上`)
  lines.push('')

  rounds.forEach((r, i) => {
    const tag = r.allSame ? '　对上了' : r.timedOut ? '　时间到' : ''
    lines.push(`第 ${r.round || i + 1} 次${tag}`)
    for (const row of expandRound(r)) {
      lines.push(`${row.name}　${row.word}`)
    }
    lines.push('')
  })

  const last = rounds[rounds.length - 1]
  if (last?.allSame && last.groups?.[0]) {
    lines.push(`最后是「${last.groups[0].word}」`)
  }
  return lines.join('\n').trim()
}

function themeColors() {
  const cs = getComputedStyle(document.documentElement)
  const pick = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback
  return {
    bg: pick('--bg', '#ebf4f8'),
    panel: pick('--panel', '#ffffff'),
    ink: pick('--ink', '#11616b'),
    ink2: pick('--ink-2', '#3f7d86'),
    ink3: pick('--ink-3', '#7fa3aa'),
    accent: pick('--accent', '#dc8b70'),
    peach: pick('--peach', '#fed9cd'),
    teal2: pick('--teal-2', '#7bbdb6'),
    line: pick('--line', '#c5d8de'),
    serif: pick('--serif', 'Songti SC'),
  }
}

/** 出现顺序即列顺序：第一轮谁先交谁排前面（groups 按 count 排过，稳定即可） */
function collectPeople(rounds) {
  const order = []
  for (const r of rounds) {
    for (const row of expandRound(r)) {
      if (!order.includes(row.name)) order.push(row.name)
    }
  }
  return order
}

function wordAt(round, name) {
  for (const g of round.groups || []) {
    if ((g.names || []).includes(name)) return g.word
  }
  return null
}

/**
 * 矩阵分享图：列 = 人，行 = 轮次。
 * 宽度按人数字适应（16 个人也能每列放得下一个词），导出 2 倍图。
 */
export function buildImage(rounds, meta) {
  const c = themeColors()
  const SERIF = `${c.serif.split(',')[0].replace(/"/g, '')}, "Songti SC", SimSun, Georgia, serif`
  const SANS = '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
  const MONO = 'ui-monospace, Menlo, Consolas, monospace'

  const people = collectPeople(rounds)
  const dpr = 2
  const PAD = 56
  const LABEL_W = 54
  const NAME_FONT = `600 16px ${SANS}`
  const WORD_FONT = `400 21px ${SERIF}`

  // 先建一个临时画布量字宽
  const probe = document.createElement('canvas').getContext('2d')

  const clampName = (n) => ([...n].length > 6 ? [...n].slice(0, 6).join('') + '…' : n)
  const colW = people.map((name) => {
    probe.font = NAME_FONT
    const nw = probe.measureText(clampName(name)).width
    let ww = 0
    for (const r of rounds) {
      const w = wordAt(r, name)
      if (w) {
        probe.font = WORD_FONT
        ww = Math.max(ww, probe.measureText(w).width)
      }
    }
    return Math.round(Math.min(240, Math.max(92, nw + 30, ww + 34)))
  })

  const W = PAD * 2 + LABEL_W + colW.reduce((a, b) => a + b, 0)
  const HEAD = 208
  const HEAD_ROW = 56
  const ROW_H = 54
  const FOOT = 118
  const H = HEAD + HEAD_ROW + rounds.length * ROW_H + FOOT

  const cv = document.createElement('canvas')
  cv.width = W * dpr
  cv.height = H * dpr
  const ctx = cv.getContext('2d')
  ctx.scale(dpr, dpr)

  // 底 + 顶部一层暖光
  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W / 2, -100, 40, W / 2, -100, H * 0.75)
  glow.addColorStop(0, 'rgba(254,217,205,0.55)')
  glow.addColorStop(1, 'rgba(254,217,205,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  // 页眉
  ctx.fillStyle = c.accent
  ctx.font = `600 12px ${SANS}`
  ctx.letterSpacing = '4px'
  ctx.fillText('RESONANCE', PAD, 84)

  ctx.fillStyle = c.ink
  ctx.font = `400 50px ${SERIF}`
  ctx.letterSpacing = '8px'
  ctx.fillText('共振 · 这一局', PAD, 150)

  ctx.fillStyle = c.ink3
  ctx.font = `400 14px ${SANS}`
  ctx.letterSpacing = '1px'
  ctx.fillText(
    `${people.length} 个人 · ${rounds.length} 次${rounds.some((r) => r.timedOut) ? ' · 有到点结算的轮次' : ''}`,
    PAD,
    184,
  )
  ctx.letterSpacing = '0px'

  // 表格几何
  const tableX = PAD
  const tableW = LABEL_W + colW.reduce((a, b) => a + b, 0)
  const headY = HEAD
  const xs = []
  {
    let x = tableX + LABEL_W
    for (const w of colW) {
      xs.push(x + w / 2)
      x += w
    }
  }

  // 表头：名字
  ctx.font = NAME_FONT
  ctx.letterSpacing = '1px'
  ctx.textAlign = 'center'
  people.forEach((name, i) => {
    ctx.fillStyle = c.ink
    ctx.fillText(clampName(name), xs[i], headY + 34)
  })
  ctx.letterSpacing = '0px'

  // 表头下的一条青色细线
  ctx.fillStyle = c.teal2
  ctx.fillRect(tableX, headY + HEAD_ROW - 12, tableW, 2)

  // 每一轮一行
  const last = rounds[rounds.length - 1]
  rounds.forEach((r, ri) => {
    const y = headY + HEAD_ROW + ri * ROW_H
    const isFinal = ri === rounds.length - 1 && r.allSame

    // 最后一行（对上的那轮）整行铺蜜桃底
    if (isFinal) {
      ctx.fillStyle = c.peach
      ctx.fillRect(tableX, y + 5, tableW, ROW_H - 10)
    }

    // 行号
    ctx.fillStyle = isFinal ? c.ink : c.ink3
    ctx.font = `400 13px ${MONO}`
    ctx.textAlign = 'left'
    ctx.fillText(String(ri + 1).padStart(2, '0'), tableX, y + ROW_H / 2 + 5)

    // 每个人的词
    ctx.textAlign = 'center'
    people.forEach((name, i) => {
      const w = wordAt(r, name)
      if (w == null) {
        ctx.fillStyle = c.ink3
        ctx.font = `400 14px ${SANS}`
        ctx.fillText('—', xs[i], y + ROW_H / 2 + 5)
        return
      }
      // 词太长就缩字号，塞不下一律截断
      let size = 21
      probe.font = `${400} ${size}px ${SERIF}`
      let ww = probe.measureText(w).width
      if (ww > colW[i] - 20) {
        size = Math.max(13, Math.floor((size * (colW[i] - 20)) / ww))
      }
      ctx.font = `400 ${size}px ${SERIF}`
      ctx.letterSpacing = '1px'
      ctx.fillStyle = isFinal ? '#b25a3c' : c.ink
      ctx.fillText(w, xs[i], y + ROW_H / 2 + 6)
      ctx.letterSpacing = '0px'
    })
  })

  // 页脚
  const footY = headY + HEAD_ROW + rounds.length * ROW_H
  ctx.fillStyle = c.line
  ctx.fillRect(tableX, footY + 14, tableW, 1)

  ctx.textAlign = 'left'
  if (last?.allSame && last.groups?.[0]) {
    ctx.fillStyle = c.ink
    ctx.font = `400 22px ${SERIF}`
    ctx.letterSpacing = '2px'
    ctx.fillText(`最后是「${last.groups[0].word}」`, tableX, footY + 56)
    ctx.letterSpacing = '0px'
  }

  ctx.fillStyle = c.ink3
  ctx.font = `400 12px ${SANS}`
  ctx.letterSpacing = '2px'
  ctx.fillText('— 同一时间，同一个词 —', tableX, H - 26)
  ctx.letterSpacing = '0px'

  return cv
}

export function downloadCanvas(canvas, filename) {
  const url = canvas.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 老浏览器兜底
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    return ok
  }
}
