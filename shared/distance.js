/**
 * 默契里程：一轮没对上，在场每人背 200 m，累计出「这局要一起跑完的距离」。
 * 纯数据模块，前后端共用——服务端只管算账，这里负责把这距离讲得好玩。
 */

export const PER_ROUND_M = 200

export const MARATHON_M = 42_195
export const TRACK_LAP_M = 400

/** 参照物从小到大；goal = 攒够这个数就能做到的事 */
const BENCHMARKS = [
  { m: 1_000, goal: '从寝室走到食堂打个来回' },
  { m: 10_000, goal: '完成一场像样的城市晨跑' },
  { m: MARATHON_M, goal: '跑完一个全程马拉松' },
  { m: 100_000, goal: '从上海跑到苏州' },
  { m: 180_000, goal: '从上海跑到杭州' },
  { m: 320_000, goal: '从上海跑到南京' },
  { m: 1_318_000, goal: '沿京沪线从上海跑到北京' },
  { m: 40_075_000, goal: '沿赤道把地球绕一圈' },
  { m: 384_400_000, goal: '从地球跑到月球' },
]

/** 1,600 m / 12.4 km / 1,318 km */
export function formatMeters(m) {
  const M = Math.round(m)
  if (M < 10_000) return `${M.toLocaleString('en-US')} m`
  if (M < 100_000) return `${(M / 1000).toFixed(1)} km`
  return `${Math.round(M / 1000).toLocaleString('en-US')} km`
}

function lapText(m) {
  const laps = m / TRACK_LAP_M
  if (laps < 10) return laps.toFixed(1)
  return String(Math.round(laps))
}

/**
 * 把一段距离讲出花来：
 *   { fmt: '1,600 m', quips: ['≈ 绕标准操场 4.0 圈', '还差 40,595 m 就能跑完一个全程马拉松'] }
 * 最多三句：操场圈数 → 已经过掉的里程碑 → 下一个够得着的里程碑。
 */
export function describeDistance(meters) {
  const m = Math.max(0, Math.round(meters))
  const quips = []

  if (m < TRACK_LAP_M) {
    quips.push('操场一圈都还没凑够')
  } else {
    quips.push(`≈ 绕标准操场 ${lapText(m)} 圈`)
  }

  let passed = null
  let next = null
  for (const b of BENCHMARKS) {
    if (b.m <= m) passed = b
    else if (!next) next = b
  }
  if (passed) quips.push(`已经${passed.goal}`)
  if (next) quips.push(`还差 ${formatMeters(next.m - m)} 就能${next.goal}`)

  return { fmt: formatMeters(m), quips }
}
