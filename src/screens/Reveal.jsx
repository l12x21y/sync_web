import Shell from '../components/Shell.jsx'

export default function Reveal({ room, isHost, onNext, onAgain, onLeave }) {
  const r = room.reveal
  if (!r) return null

  if (r.allSame) {
    const word = r.groups[0]?.word ?? ''
    const names = r.groups[0]?.names ?? []
    return (
      <Shell
        center
        meta={`第 ${r.round} 轮 · ${r.answered} 人`}
        onLeave={onLeave}
        aside={
          <>
            <div className="side-head">
              <span className="eyebrow">同时想到的人</span>
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
            <p className="lede muted" style={{ fontSize: 12.5, marginTop: 24 }}>
              第 {r.round} 轮达成一致，这一局到此为止。
            </p>
          </>
        }
      >
        <div className="hit">
          <p className="hit__eyebrow">撞 上 了</p>
          <h1 className="hit__word">{word}</h1>
          <p className="hit__sub">
            {r.answered} 个人，想到同一个词。用了 {r.round} 轮。
          </p>
        </div>

        <div className="footer" style={{ marginTop: 44, maxWidth: 340 }}>
          {isHost ? (
            <button className="btn" onClick={onAgain} type="button">
              再来一局
            </button>
          ) : (
            <p className="lede">等房主开下一局</p>
          )}
        </div>
      </Shell>
    )
  }
  return (
    <Shell meta={`第 ${r.round} 轮 · ${r.distinct} 个不同的词`} onLeave={onLeave} plain>
      <div className="verdict-row">
        <div>
          <h1 className="verdict">没撞上</h1>
          <p className="verdict__note">
            {r.distinct} 个不同的词。看一眼别人写了什么，再来一轮，直到所有人都一样。
          </p>
          {r.missing && r.missing.length ? (
            <p className="lede muted" style={{ fontSize: 12.5, marginTop: 10 }}>
              {r.missing.join('、')} 这轮没交，没算进去。
            </p>
          ) : null}
        </div>

        <div className="verdict-act">
          {isHost ? (
            <button className="btn" onClick={onNext} type="button">
              再来一轮
            </button>
          ) : (
            <p className="lede">等房主开下一轮</p>
          )}
        </div>
      </div>

      <div className="groups groups--grid">
        {r.groups.map((g, i) => (
          <div
            className={`group${i === 0 ? ' group--lead' : ''}`}
            key={`${g.word}-${i}`}
            style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
          >
            <span className="group__word">{g.word}</span>
            <span className="group__n">{g.count}</span>
            <span className="group__who">{g.names.join('、')}</span>
          </div>
        ))}
      </div>

      <div className="spacer" />
    </Shell>
  )
}
