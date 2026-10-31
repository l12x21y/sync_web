/**
 * 弹幕气泡层：谁冒了一句，一条气泡从右往左飘过去，飘完就没了。
 * 不留历史、不占版面，pointer-events 全关，不影响操作。
 */
const LANES = 6

export default function Bubbles({ chats, myId, onGone }) {
  if (!chats.length) return null
  return (
    <div className="dm" aria-live="polite">
      {chats.map((c, i) => {
        const mine = c.playerId === myId
        const lane = i % LANES
        const dur = 8 + (i % 3) // 8–10s，错开节奏
        return (
          <div
            key={c.id}
            className={`dm__b${mine ? ' dm__b--mine' : ''}`}
            style={{ top: 6 + lane * 46, '--dm-dur': `${dur}s` }}
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
