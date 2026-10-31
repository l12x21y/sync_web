import { useState } from 'react'
import Shell from '../components/Shell.jsx'
import ShareCard from '../components/ShareCard.jsx'
import DistanceNote from '../components/DistanceNote.jsx'
import { describeDistance } from '../../shared/distance.js'

export default function Reveal({ room, isHost, onNext, onAgain, onLeave }) {
  const [showLog, setShowLog] = useState(false)
  const r = room.reveal
  if (!r) return null

  const log = showLog ? (
    <ShareCard
      rounds={room.rounds || []}
      players={r.answered}
      theme={room.theme || ''}
      distance={room.distance || 0}
      onClose={() => setShowLog(false)}
    />
  ) : null

  const dist = room.distance > 0 ? describeDistance(room.distance) : null

  if (r.allSame) {
    const word = r.groups[0]?.word ?? ''
    const names = r.groups[0]?.names ?? []
    return (
      <Shell
        center
        meta={`第 ${r.round} 次 / ${r.answered} 人`}
        onLeave={onLeave}
        aside={
          <>
            <div className="side-head">
              <span className="eyebrow">都想的是这个</span>
              <span className="side-head__n">{r.answered}</span>
            </div>
            <div className="rows">
              {names.map((n, i) => (
                <div className="row" key={`${n}-${i}`} style={{ animationDelay: `${i * 30}ms` }}>
                  <span className="dot dot--on" />
                  <span className="row__name">{n}</span>
                </div>
              ))}
            </div>
            <p className="lede muted" style={{ fontSize: 12.5, marginTop: 22 }}>
              第 {r.round} 轮就对上了。
            </p>
          </>
        }
      >
        <div className="hit">
          <p className="hit__eyebrow">对 上 了</p>
          <h1 className="hit__word">{word}</h1>
          <span className="hit__rule" />
          <p className="hit__sub">
            {r.answered} 个人，同一个词，用了 {r.round} 次。
          </p>
          {dist ? (
            <p className="hit__dist">
              默契里程 {dist.fmt} · {dist.quips[0]}
            </p>
          ) : null}
        </div>

        <div className="footer" style={{ marginTop: 40, maxWidth: 380 }}>
          <div className="btn-row">
            {isHost ? (
              <button className="btn" onClick={onAgain} type="button">
                再开一局
              </button>
            ) : (
              <p className="lede muted" style={{ fontSize: 13 }}>
                等房主再开一局
              </p>
            )}
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setShowLog(true)}
              type="button"
              style={{ flex: 'none', width: 132 }}
            >
              对局记录
            </button>
          </div>
        </div>
        {log}
      </Shell>
    )
  }

  return (
    <Shell meta={`第 ${r.round} 次 / ${r.distinct} 个不同的词`} onLeave={onLeave} plain>
      <div className="verdict-row">
        <div>
          <h1 className="verdict">差一点</h1>
          <p className="verdict__note">
            {r.distinct} 个词，没有撞上的。看一眼别人写的，再写一次。
          </p>
          {r.missing && r.missing.length ? (
            <p className="lede muted" style={{ fontSize: 12.5, marginTop: 10 }}>
              {r.missing.join('、')} 这次没交
              {r.timedOut ? '，时间到了就按已交的算' : '，没算在里头'}。
            </p>
          ) : null}
        </div>

        <div className="verdict-act stack">
          {isHost ? (
            <button className="btn" onClick={onNext} type="button">
              再写一次
            </button>
          ) : (
            <p className="lede muted" style={{ fontSize: 13 }}>
              等房主开下一次
            </p>
          )}
          <button className="linkish" onClick={() => setShowLog(true)} type="button">
            对局记录
          </button>
        </div>
      </div>

      <DistanceNote distance={room.distance || 0} delta={r.penalty || 0} rule />

      <div className="groups groups--grid">
        {r.groups.map((g, i) => (
          <div
            className={`group${i === 0 && g.count > 1 ? ' group--lead' : ''}`}
            key={`${g.word}-${i}`}
            style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
          >
            {g.count > 1 ? <span className="group__n">{g.count} 人</span> : null}
            <span className="group__word">{g.word}</span>
            <span className="group__who">{g.names.join('、')}</span>
          </div>
        ))}
      </div>

      <div className="spacer" />
      {log}
    </Shell>
  )
}
