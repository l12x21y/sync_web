import { useState } from 'react'
import Shell from '../components/Shell.jsx'

export default function Play({ room, myId, onSubmit, onLeave }) {
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState('')

  const me = room.players.find((p) => p.id === myId)
  const submitted = Boolean(me?.submitted)
  const shownWord = room.myWord || pending
  const waiting = Math.max(0, room.activeCount - room.answeredCount)
  const len = [...draft].length

  function handleSubmit(e) {
    e.preventDefault()
    const w = draft.trim()
    if (!w) return
    setPending(w)
    setDraft('')
    onSubmit(w)
  }

  return (
    <Shell
      center
      meta={`第 ${room.round} 轮 · ${room.answeredCount}/${room.activeCount} 已交`}
      onLeave={onLeave}
      aside={
        <>
          <div className="side-head">
            <span className="eyebrow">这一轮</span>
            <span className="side-head__n">
              {room.answeredCount} / {room.activeCount}
            </span>
          </div>
          <div className="rows">
            {room.players.map((p) => (
              <div className="row" key={p.id}>
                <span className={`dot ${p.submitted ? 'dot--on' : 'dot--off'}`} />
                <span className="row__name">
                  {p.name}
                  {p.id === myId ? <span className="muted"> · 你</span> : null}
                </span>
                <span className={`row__state${p.submitted ? ' row__state--on' : ''}`}>
                  {!p.connected ? '掉线' : p.submitted ? '已交' : '在写'}
                </span>
              </div>
            ))}
          </div>

          <p className="lede muted" style={{ fontSize: 12.5, marginTop: 24 }}>
            全部交齐才会揭晓。别人写了什么，这会儿谁也看不到。
          </p>
        </>
      }
    >
      {submitted ? (
        <>
          <p className="eyebrow">你写的是</p>
          <p className="yourword">{shownWord}</p>
          <p className="lede" style={{ marginTop: 26 }}>
            {waiting > 0 ? `等另外 ${waiting} 个人……` : '马上揭晓'}
          </p>
          <p className="lede muted" style={{ fontSize: 12.5, marginTop: 30 }}>
            交完就不能改了，安心等。
          </p>
        </>
      ) : (
        <>
          <h1 className="verdict">同时想一个词</h1>
          <p className="verdict__note">
            想到什么写什么。越是第一个跳进脑子里的，越可能是大家都在想的那个。
          </p>

          <form onSubmit={handleSubmit} className="stack" style={{ marginTop: 40, maxWidth: 460 }}>
            <div>
              <input
                className="field field--word"
                autoFocus
                maxLength={8}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="写一个词"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 8,
                }}
              >
                <span className="label" style={{ margin: 0 }}>
                  最多 8 个字
                </span>
                <span className="label mono" style={{ margin: 0 }}>
                  {len}/8
                </span>
              </div>
            </div>

            <button className="btn" type="submit" disabled={!draft.trim()}>
              交
            </button>
          </form>
        </>
      )}
    </Shell>
  )
}
