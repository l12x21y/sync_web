import { describeDistance, PER_ROUND_M } from '../../shared/distance.js'

/**
 * 默契里程条：显示这局累计要跑的距离，配一两句好玩的参照。
 * delta = 本轮新背上的米数（揭晓页用）；rule = 是否解释规则那句。
 */
export default function DistanceNote({ distance, delta = 0, rule = false }) {
  if (!distance || distance <= 0) return null
  const { fmt, quips } = describeDistance(distance)

  return (
    <div className="dist">
      <div className="dist__head">
        <span className="dist__label">DISTANCE · 默契里程</span>
        {delta > 0 ? <span className="dist__delta">+{delta.toLocaleString('en-US')} m</span> : null}
        <span className="dist__value">{fmt}</span>
      </div>
      <p className="dist__quips">{quips.join(' · ')}</p>
      {rule ? (
        <p className="dist__rule">
          一轮没对上，在场每人背 {PER_ROUND_M} m，全部记进这局的里程。
        </p>
      ) : null}
    </div>
  )
}
