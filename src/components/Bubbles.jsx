/**
 * 弹幕气泡层：谁冒了一句，一条气泡从右往左飘过去，飘完就没了。
 * 不留历史、不占版面，pointer-events 全关，不影响操作。
 *
 * 轨道在气泡出生时一次性定死：挑一条「最早空出来」的轨道，
 * 之后就沿着这一条走完，不会因为别的气泡消失而跳轨。
 * 同一条轨道还没空出来时，后来的气泡延迟登场（--dm-delay），
 * 等前车飘出安全身位再进画面，所以永远追不上、也不会叠。
 */
import { useRef } from 'react'
import { makeLaneAllocator } from '../laneMath.js'

const LANES = 6
const LANE_H = 46 // 与 CSS 里 top 步长一致
const TOP = 6 // 首条轨道的起点偏移
const TRAVEL_S = 9 // 单个气泡从右飘到左的时长
const LEAD_S = 1.6 // 同轨后车要等前车走出的身位（秒）

export default function Bubbles({ chats, myId, onGone }) {
  const allocRef = useRef(null)
  if (!allocRef.current) {
    allocRef.current = makeLaneAllocator({ lanes: LANES, travel: TRAVEL_S, lead: LEAD_S })
  }

  if (!chats.length) return null

  const now = performance.now() / 1000
  const assign = allocRef.current

  return (
    <div className="dm" aria-live="polite">
      {chats.map((c) => {
        assign(c, now) // 首次出现时定轨道，之后原样返回，不跳轨
        const mine = c.playerId === myId
        return (
          <div
            key={c.id}
            className={`dm__b${mine ? ' dm__b--mine' : ''}`}
            style={{
              top: TOP + c.lane * LANE_H,
              '--dm-dur': `${TRAVEL_S}s`,
              '--dm-delay': `${Math.max(0, c.at - now)}s`,
            }}
            onAnimationEnd={() => onGone(c.id)}
          >
            <span className="dm__name">{mine ? '你' : c.from}</span>
            <span className="dm__text">{c.text}</span>
          </div>
        )
      })}
    </div>
  )
}
