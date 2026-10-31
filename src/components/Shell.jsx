export default function Shell({ meta, onLeave, aside, center, sideCenter, plain, children }) {
  const mainClass = plain
    ? 'pane pane--plain'
    : `pane pane--main${center ? ' pane--main--center' : ''}`

  return (
    <div className="screen">
      <header className="bar">
        <div className="brand">
          <span className="brand__name">同词相见</span>
          <span className="brand__en">TONGCI</span>
        </div>
        <div className="bar__right">
          {meta ? <span className="bar__meta">{meta}</span> : null}
          {onLeave ? (
            <button className="bar__leave" onClick={onLeave} type="button">
              离开
            </button>
          ) : null}
        </div>
      </header>

      {plain ? (
        <main className={mainClass}>{children}</main>
      ) : (
        <div className="cols">
          <main className={mainClass}>{children}</main>
          {aside ? (
            <aside className={`pane pane--side${sideCenter ? ' pane--side--center' : ''}`}>
              {aside}
            </aside>
          ) : null}
        </div>
      )}
    </div>
  )
}
