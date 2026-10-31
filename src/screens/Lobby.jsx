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
      meta={`房间 ${room.code} / 到了 ${count} 人`}
      onLeave={onLeave}
      aside={
        <>
          <div className="side-head">
            <span className="eyebrow">已经进来的人</span>
            <span className="side-head__n">{count} / 16</span>
          </div>
          <div className="rows">
            {room.players.map((p) => (
              <div className="row" key={p.id}>
                <span className={`dot ${p.connected ? 'dot--on' : 'dot--off'}`} />
                <span className="row__name">
                  {p.name}
                  {p.id === myId ? <span className="muted">（你）</span> : null}
                </span>
                {p.id === room.hostId ? <span className="row__tag">房主</span> : null}
              </div>
            ))}
          </div>

          <div className="footer stack" style={{ marginTop: 24 }}>
            {isHost ? (
              <>
                <button className="btn" onClick={onStart} disabled={count < 2} type="button">
                  开始
                </button>
                {count < 2 ? (
                  <p className="lede center muted" style={{ fontSize: 12.5 }}>
                    一个人没法玩，等第二个人
                  </p>
                ) : null}
              </>
            ) : (
              <p className="lede muted" style={{ fontSize: 13 }}>
                等房主按下开始
              </p>
            )}
          </div>
        </>
      }
    >
      <p className="eyebrow">房间号</p>
      <div className="code">
        {[...room.code].map((d, i) => (
          <span className="code__cell" key={i}>
            {d}
          </span>
        ))}
      </div>
      <p className="code-hint">念给他们听，或者直接把链接甩过去。</p>

      <div className="btn-row" style={{ marginTop: 26, maxWidth: 380 }}>
        <button className="btn btn--ghost btn--sm" onClick={() => copy('code')} type="button">
          {copied === 'code' ? '房号已复制' : '复制房号'}
        </button>
        <button className="btn btn--sm" onClick={() => copy('link')} type="button">
          {copied === 'link' ? '链接已复制' : '复制邀请链接'}
        </button>
      </div>

      <p className="lede muted" style={{ fontSize: 12.5, marginTop: 24 }}>
        别刷新页面，刷新会掉回原来的位子。
      </p>
      <p className="mono muted" style={{ fontSize: 11, marginTop: 8, wordBreak: 'break-all' }}>
        {inviteLink(room.code)}
      </p>
      <div className="spacer" />
    </Shell>
  )
}
