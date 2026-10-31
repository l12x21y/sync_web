/**
 * 到点兜底：有人没交也能出结果。
 * 需要以 ROUND_SECONDS=3 起一个实例，例如：
 *   PORT=5199 ROUND_SECONDS=3 node server.js
 *   WS_URL=ws://localhost:5199/ws node test/timeout.mjs
 */
import WebSocket from 'ws'

const WS_URL = process.env.WS_URL || 'ws://localhost:5199/ws'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function client(tag) {
  const ws = new WebSocket(WS_URL)
  const c = { tag, ws, room: null, id: null, errors: [] }
  c.send = (m) => ws.send(JSON.stringify(m))
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw))
    if (m.type === 'joined') {
      c.id = m.playerId
      c.room = m.room
    } else if (m.type === 'state') c.room = m.room
    else if (m.type === 'error') c.errors.push(m.message)
  })
  return c
}

const wait = async (fn, timeout = 15000, label = '') => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (fn()) return true
    await sleep(60)
  }
  throw new Error(`超时：${label}`)
}

let failed = 0
function ok(cond, name) {
  if (cond) console.log('✅', name)
  else {
    console.log('❌', name)
    failed += 1
  }
}

async function main() {
  const host = client('host')
  const a = client('a')
  const b = client('b')
  const all = [host, a, b]
  await wait(() => all.every((c) => c.ws.readyState === 1), 6000, '连接')

  host.send({ type: 'create', name: '房主' })
  await wait(() => host.room, 4000, '建房')
  const code = host.room.code

  a.send({ type: 'join', code, name: '甲' })
  b.send({ type: 'join', code, name: '乙' })
  await wait(() => a.room && b.room, 4000, '入座')

  host.send({ type: 'start' })
  await wait(() => a.room?.phase === 'answering', 4000, '开局')
  ok(a.room.deadlineIn > 0, `开局后带上了倒计时（${Math.round(a.room.deadlineIn / 1000)}s）`)

  // 三个人里只交两个，第三个故意不交
  host.send({ type: 'submit', word: '温泉' })
  a.send({ type: 'submit', word: '温泉' })
  await sleep(300)
  ok(!b.room?.reveal, '没交齐就不揭晓')

  await wait(() => b.room?.reveal, 12000, '到点结算')
  const r = b.room.reveal
  ok(r.timedOut === true, '结果带上了「时间到」标记')
  ok(r.answered === 2, `只算已交的两个人（实得 ${r.answered}）`)
  ok(r.allSame === true, '两个人一样就算对上')
  ok(r.missing.length === 1 && r.missing[0] === '乙', `没交的人记在 missing（${r.missing.join('、')}）`)
  ok(b.room.rounds.length === 1 && b.room.rounds[0].timedOut === true, '这轮写进了记录，标了时间到')

  all.forEach((c) => c.ws.close())
  await sleep(200)
  console.log(failed === 0 ? '\n全部通过' : `\n${failed} 条没过`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('失败:', e.message)
  process.exit(1)
})
