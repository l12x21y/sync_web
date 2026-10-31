import { useState } from 'react'
import Shell from '../components/Shell.jsx'

function inviteLink(code) {
  const { origin, pathname } = window.location
  return `${origin}${pathname}?r=${code}`
}

export default function Lobby({ room, myId, isHost, onStart, onLeave }) {
  const [copied, setCopied] = useState('')
  const count = room.players.length

  async function copy(kind) {
    const text = kind === 'code' ? room.code : inviteLink(room.code)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      window.setTimeout(() => setCopied(''), 1600)
    } catch {
      setCopied('')
    }
  }

  return (
    <Shell
      center
      meta={`房号 ${room.code} · 在座 ${count} 人`}
      onLeave={onLeave}
      aside={
        <>
          <div className="side-head">
            <span className="eyebrow">在座</span>
            <span className="side-head__n">
              {count} / 16
            </span>
          </div>
          <div className="rows">
            {room.players.map((p) => (
              <div className="row" key={p.id}>
                <span className={`dot ${p.connected ? 'dot--on' : 'dot--off'}`} />
                <span className="row__name">
                  {p.name}
                  {p.id === myId ? <span className="muted"> · 你</span> : null}
                </span>
                {p.id === room.hostId ? <span className="row__tag">房主</span> : null}
              </div>
            ))}
          </div>

          <div className="footer stack" style={{ marginTop: 26 }}>
            {isHost ? (
              <>
                <button className="btn" onClick={onStart} disabled={count < 2} type="button">
                  开始
                </button>
                {count < 2 ? <p className="lede center">再来一个人就能开始</p> : null}
              </>
            ) : (
              <p className="lede center">等房主开始</p>
            )}
          </div>
        </>
      }
    >
      <p className="eyebrow">房号</p>
      <p className="code" style={{ marginTop: 18 }}>
        {room.code}
      </p>
      <p className="code-hint">把这 4 位念给他们，或者直接把邀请链接发过去。</p>

      <div className="btn-row" style={{ marginTop: 28, maxWidth: 340 }}>
        <button className="btn btn--ghost btn--sm" onClick={() => copy('code')} type="button">
          {copied === 'code' ? '已复制房号' : '复制房号'}
        </button>
        <button className="btn btn--sm" onClick={() => copy('link')} type="button">
          {copied === 'link' ? '已复制链接' : '复制邀请链接'}
        </button>
      </div>

      <p className="lede muted" style={{ fontSize: 12.5, marginTop: 30 }}>
        进房间之后就别刷新了，刷新会自动回到原来的座位。
      </p>
      <p className="mono muted" style={{ fontSize: 11, marginTop: 10, wordBreak: 'break-all' }}>
        {inviteLink(room.code)}
      </p>
    </Shell>
  )
}
