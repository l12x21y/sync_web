import { makeLaneAllocator } from '../src/laneMath.js'

let pass = 0
const ok = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg)
  pass++
  console.log('  ok', msg)
}

// 1. 连续 6 条：应该落在 6 条不同轨道上，且不延迟
{
  const assign = makeLaneAllocator()
  const got = [1, 2, 3, 4, 5, 6].map((id) => assign({ id }, 100))
  const lanes = got.map((c) => c.lane)
  ok(new Set(lanes).size === 6, `6 条消息铺满 6 条轨道（${lanes.join(',')}）`)
  ok(got.every((c) => c.at === 100), '铺得下时全部立即出场')
}

// 2. 第 7 条：没有空轨道 → 排队，落在最早空出来的那条
{
  const assign = makeLaneAllocator()
  for (let i = 0; i < 6; i++) assign({ id: i }, 100)
  const c = assign({ id: 7 }, 100)
  ok(c.at === 101.6, `第 7 条排到 1.6s 后再上（实得 ${c.at - 100}s）`)
  ok(c.lane === 0, '落在最早排队的轨道 0')
}

// 3. 不跳轨：分配过的对象再次经过分配器，lane/at 都不变
{
  const assign = makeLaneAllocator()
  const c = assign({ id: 'a' }, 50)
  for (let i = 0; i < 8; i++) assign({ id: 'x' + i }, 50)
  const laneBefore = c.lane
  const atBefore = c.at
  assign(c, 60)
  ok(c.lane === laneBefore && c.at === atBefore, '已分配的气泡再渲染时轨道/时刻保持不变（不跳轨）')
}

// 4. 时间往前走之后，空出来的轨道能被复用，且延迟为 0
{
  const assign = makeLaneAllocator()
  for (let i = 0; i < 6; i++) assign({ id: i }, 100)
  const later = assign({ id: 'late' }, 200)
  ok(later.at === 200, '过了一段时间（100s 后）新气泡立即出场')
  ok(later.lane === 0, '复用最早空出来的轨道')
}

console.log(`\n${pass} 条断言全过`)
