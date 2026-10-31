/**
 * 端到端冒烟：用真实 WebSocket 客户端跑完整一局，重点压多人在场（16 人）。
 * 用法：先 `node server.js`，另开终端 `node test/smoke.mjs`
 *      或生产模式：`WS_URL=ws://localhost:5180/ws node test/smoke.mjs`
 */
import WebSocket from 'ws'

const URL = process.env.WS_URL || 'ws://localhost:5173/ws'
const log = (...a) => console.log('  ', ...a)
let failed = 0

function assert(cond, msg) {
  if (cond) log('✅', msg)
  else {
    failed += 1
    log('❌', msg)
  }
}

function makeClient(name) {
  const ws = new WebSocket(URL)
  const c = { name, ws, room: null, id: null, errors: [], chats: [], left: false, open: false }
  ws.on('open', () => {
    c.open = true
  })
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw))
    if (m.type === 'joined') {
      c.id = m.playerId
      c.room = m.room
    } else if (m.type === 'state') {
      c.room = m.room
    } else if (m.type === 'left') {
      c.left = true
      c.room = null
    } else if (m.type === 'chat') {
      c.chats.push(m)
    } else if (m.type === 'error') {
      c.errors.push(m.message)
    }
  })
  return c
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function until(fn, timeout = 5000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (fn()) return true
    await wait(20)
  }
  return false
}

const send = (c, msg) => c.ws.send(JSON.stringify(msg))

async function run() {
  const NAME = '阿真'
  const PEERS = Array.from({ length: 15 }, (_, i) => `玩家${String(i + 1).padStart(2, '0')}`)
  const host = makeClient(NAME)
  const peers = PEERS.map(makeClient)
  const all = [host, ...peers]

  await until(() => all.every((c) => c.open))
  assert(all.every((c) => c.open), '16 个连接建立')

  // 弹幕：没进房间不能说
  send(host, { type: 'chat', text: '还没进房就想说话' })
  await wait(250)
  assert(
    host.errors.some((m) => /还没进房间/.test(m)),
    '没进房间发消息被拦',
  )

  send(host, { type: 'create', name: NAME })
  await until(() => host.room)
  assert(host.room?.phase === 'lobby', '建房成功，进入 lobby')
  const code = host.room.code
  assert(/^\d{4}$/.test(code), `房号是 4 位数字：${code}`)
  assert(host.room.roundSeconds === 30, '默认每轮限时 30 秒')

  peers.forEach((p) => send(p, { type: 'join', code, name: p.name }))
  await until(() => host.room.players.length === 16)
  assert(host.room.players.length === 16, '16 人全部进场')

  // 弹幕：进房后广播给所有人，清洗空白，30 字封顶
  send(host, { type: 'chat', text: '  大家好\n啊  ' })
  await until(() => all.every((c) => c.chats.length === 1), 4000)
  const hello = peers[0].chats[0]
  assert(hello?.text === '大家好 啊', `空白被清洗：${JSON.stringify(hello?.text)}`)
  assert(hello?.from === '阿真', '气泡带名字')
  assert(hello?.playerId === host.id, '气泡带发言人 id（客户端好标「你」）')

  // 30 字上限：超长截断（先等限流窗口过去）
  await wait(850)
  send(host, { type: 'chat', text: '一二三四五六七八九一二三四五六七八九一二三四五六七八九一二三四五六七八九' })
  await until(() => peers[0].chats.length === 2, 4000)
  assert(peers[0].chats[1].text.length === 30, `超长截到 30 字（实得 ${peers[0].chats[1].text.length}）`)

  // 防刷屏：800ms 内第二句被悄悄丢掉
  const before = peers[0].chats.length
  send(host, { type: 'chat', text: '刷得太快' })
  await wait(500)
  assert(peers[0].chats.length === before, '800ms 内连发的第二句被丢弃')

  // 别人也能说
  send(peers[1], { type: 'chat', text: '我先想想' })
  await until(() => host.chats.some((c) => c.from === '玩家02'), 4000)
  assert(host.chats.some((c) => c.text === '我先想想'), '房间里人人都能冒泡')

  // 房主改设置：限时 + 题目
  send(host, { type: 'settings', roundSeconds: 8, theme: '一种热带水果' })
  await wait(250)
  assert(host.room.roundSeconds === 8, '限时改成 8 秒')
  assert(host.room.theme === '一种热带水果', '题目已设置')

  // 越界值被夹回合法区间
  send(host, { type: 'settings', roundSeconds: 9999 })
  await wait(200)
  assert(host.room.roundSeconds === 300, '限时上限 300 秒')
  send(host, { type: 'settings', roundSeconds: 8 })
  await wait(200)

  // 非房主改设置应被拦
  send(peers[0], { type: 'settings', roundSeconds: 120 })
  await wait(200)
  assert(host.room.roundSeconds === 8, '非房主改不动设置')

  // 第 17 个人应该被挡在门外
  const extra = makeClient('多余的人')
  await until(() => extra.open)
  send(extra, { type: 'join', code, name: '多余的人' })
  await wait(250)
  assert(
    extra.errors.some((m) => /最多/.test(m)),
    '超过 16 人被拒：' + (extra.errors[0] || '（没有报错）'),
  )
  extra.ws.close()

  // 非房主开局应被拦
  send(peers[0], { type: 'start' })
  await wait(200)
  assert(peers[0].errors.length > 0, '非房主不能开局')

  send(host, { type: 'start' })
  await until(() => all.every((c) => c.room?.phase === 'answering'), 8000)
  assert(host.room.phase === 'answering' && host.room.round === 1, '开局进入第 1 轮')
  assert(host.room.activeCount === 16, '16 人都在作答')
  assert(
    host.room.deadlineIn > 0 && host.room.deadlineIn <= 8000,
    `房主设的限时生效（剩 ${host.room.deadlineIn}ms）`,
  )
  assert(host.room.theme === '一种热带水果', '作答状态带着题目')

  // 开局以后不能再改设置
  send(host, { type: 'settings', roundSeconds: 60 })
  await wait(200)
  assert(host.room.roundSeconds === 8, '开局以后改不动设置')

  // 一人先交：进度可见，内容不可见
  send(host, { type: 'submit', word: '  苹果！ ' })
  await until(() => host.room.answeredCount === 1)
  assert(host.room.phase === 'answering', '一人交完不揭晓')
  assert(host.room.players.find((p) => p.id === host.id)?.word === null, '不下发任何人的答案')
  assert(host.room.myWord === '苹果！', '本人拿得到自己写的词（已去首尾空白）')
  const peerView = peers[0].room.players.find((p) => p.id === host.id)
  assert(peerView?.word === null, '别人看不到房主写了什么')
  assert(peerView?.submitted === true, '但能看到"已交"这个状态')

  // 全员交不同词
  peers.forEach((p, i) => send(p, { type: 'submit', word: `词${i}a` }))
  await until(() => host.room.phase === 'reveal', 8000)
  assert(host.room.phase === 'reveal', '16 人交齐立即揭晓')
  assert(host.room.reveal.distinct === 16, `16 个不同的词（实得 ${host.room.reveal.distinct}）`)
  assert(host.room.reveal.allSame === false, '没撞上')
  assert(
    host.room.reveal.groups.every((g) => g.names.length === g.count),
    '每一组都带着人名，人数对得上',
  )

  // 默契里程：一轮没对上，16 人 × 200 m
  assert(host.room.distance === 3200, `一轮没对上，累计 3,200 m（实得 ${host.room.distance}）`)
  assert(host.room.reveal.penalty === 3200, '揭晓结果带上本轮 +3,200 m')
  assert(host.room.rounds[0].distance === 3200, '轮次记录里存了累计里程')

  // 非房主推进
  send(peers[0], { type: 'next' })
  await wait(200)
  assert(peers[0].errors.length > 1, '非房主不能推进')

  send(host, { type: 'next' })
  await until(() => host.room.round === 2 && host.room.phase === 'answering')
  assert(host.room.round === 2, '房主推进到第 2 轮')

  // 全员同一个词（故意带不同标点，验证归一化）
  send(host, { type: 'submit', word: '夏天' })
  peers.forEach((p, i) => send(p, { type: 'submit', word: i % 2 ? '夏天。' : '夏天！' }))
  await until(() => host.room.phase === 'reveal', 8000)
  assert(host.room.reveal.allSame === true, '「夏天」「夏天。」「夏天！」归一化后判为同一个词')
  assert(host.room.reveal.round === 2, '第 2 轮撞上')

  // 对上的一轮不涨里程；再开一局清零
  assert(host.room.distance === 3200, `对上的这轮不涨里程（仍 ${host.room.distance} m）`)
  assert(host.room.reveal.penalty === 0, '对上的一轮 penalty 为 0')

  // 超长词拦截（回到 lobby 再试）
  send(host, { type: 'again' })
  await until(() => host.room.phase === 'lobby')
  assert(host.room.phase === 'lobby', '再来一局回到 lobby')
  assert(host.room.rounds.length === 0, '局数记录已清空')
  assert(host.room.distance === 0, '再开一局，里程清零')

  send(host, { type: 'start' })
  await until(() => host.room.phase === 'answering')
  const errBefore = host.errors.length
  send(host, { type: 'submit', word: '一二三四五六七八九' })
  await wait(200)
  assert(host.errors.length > errBefore, '超过 8 个字被拦下')

  // 中途离开：座位立刻腾出来
  const quitter = peers[0]
  send(quitter, { type: 'leave' })
  await until(() => host.room.players.length === 15)
  assert(host.room.players.length === 15, '有人离开，房间剩 15 人')
  assert(quitter.left === true, '离开者收到确认')

  all.slice(1).forEach((c) => c.ws.close())
  host.ws.close()
  await wait(200)
  console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
  process.exit(failed === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
