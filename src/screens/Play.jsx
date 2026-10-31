import { useEffect, useState } from 'react'
import Shell from '../components/Shell.jsx'

export default function Play({ room, myId, onSubmit, onLeave }) {
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState('')
  const [left, setLeft] = useState(0)

  const me = room.players.find((p) => p.id === myId)
  const submitted = Boolean(me?.submitted)
  const shownWord = room.myWord || pending
  const waiting = Math.max(0, room.activeCount - room.answeredCount)
  const len = [...draft].length

  // 服务端只下发「还剩多少毫秒」，本地每秒递减，不受时区/时钟差影响
  useEffect(() => {
    if (!room.deadlineIn) {
      setLeft(0)
      return undefined
    }
    setLeft(Math.ceil(room.deadlineIn / 1000))
    const t = window.setInterval(() => {
      setLeft((v) => (v > 0 ? v - 1 : 0))
    }, 1000)
    return () => window.clearInterval(t)
  }, [room.deadlineIn, room.round])

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
      meta={
        <>
          第 {room.round} 次 / {room.answeredCount} 人已交
          {left > 0 ? (
            <span className={left <= 10 ? 'countdown countdown--urgent' : 'countdown'}>
              {left}s
            </span>
          ) : null}
        </>
      }
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
                  {p.id === myId ? <span className="muted">（你）</span> : null}
                </span>
                <span className={`row__state${p.submitted ? ' row__state--on' : ''}`}>
                  {!p.connected ? '不在' : p.submitted ? '交了' : '在想'}
                </span>
              </div>
            ))}
          </div>

          <p className="lede muted" style={{ fontSize: 12.5, marginTop: 22 }}>
            人齐才揭晓。现在这一秒，谁写了什么你自己也看不到。
          </p>
        </>
      }
    >
      {submitted ? (
        <>
          <p className="eyebrow">你写的是</p>
          <p className="yourword">{shownWord}</p>
          <p className="lede" style={{ marginTop: 24 }}>
            {waiting > 0 ? `还差 ${waiting} 个人` : '人都交齐了'}
          </p>
          <p className="lede muted" style={{ fontSize: 12.5, marginTop: 26 }}>
            交出去就收不回，先别动。
          </p>
        </>
      ) : (
        <>
          <p className="kicker">ROUND {room.round}</p>
          {room.theme ? (
            <p className="prompt">
              <span className="prompt__label">题目</span>
              <span className="prompt__word">{room.theme}</span>
            </p>
          ) : null}
          <h1 className="verdict">写一个词</h1>
          <p className="verdict__note">
            第一反应的那个就是对的那个。想到什么写什么，别改。
          </p>

          <form onSubmit={handleSubmit} className="stack" style={{ marginTop: 32, maxWidth: 460 }}>
            <div>
              <input
                className="field field--word"
                autoFocus
                maxLength={8}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="就一个词"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 9,
                }}
              >
                <span className="label" style={{ margin: 0 }}>
                  最多八个字
                </span>
                <span className="label mono" style={{ margin: 0 }}>
                  {len}/8
                </span>
              </div>
            </div>

            <button className="btn" type="submit" disabled={!draft.trim()}>
              交上去
            </button>
          </form>
        </>
      )}
    </Shell>
  )
}
