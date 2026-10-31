import { useEffect, useRef, useState } from 'react'
import Shell from '../components/Shell.jsx'

const TIME_OPTIONS = [15, 30, 45, 60, 90, 120]

function inviteLink(code) {
  const { origin, pathname } = window.location
  return `${origin}${pathname}?r=${code}`
}

export default function Lobby({ room, myId, isHost, onStart, onSettings, onLeave }) {
  const [copied, setCopied] = useState('')
  const [themeDraft, setThemeDraft] = useState(room.theme || '')
  const draftRef = useRef(room.theme || '')
  const savedThemeRef = useRef(room.theme || '')
  const timerRef = useRef(null)
  const count = room.players.length

  // 继承房主位时，把当前题目同步进来
  useEffect(() => {
    if (isHost) {
      setThemeDraft(room.theme || '')
      draftRef.current = room.theme || ''
      savedThemeRef.current = room.theme || ''
    }
  }, [isHost]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    },
    [],
  )

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

  function setTime(sec) {
    if (!isHost || sec === room.roundSeconds) return
    onSettings({ roundSeconds: sec })
  }

  function flushTheme() {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const next = (draftRef.current || '').trim()
    if (next !== savedThemeRef.current) {
      savedThemeRef.current = next
      onSettings({ theme: next })
    }
  }

  function changeTheme(v) {
    draftRef.current = v
    setThemeDraft(v)
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(flushTheme, 450)
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

      {/* 规则设置：只有房主能动，开局前改 */}
      {isHost ? (
        <div className="settings" style={{ marginTop: 34, maxWidth: 460 }}>
          <p className="eyebrow" style={{ marginBottom: 10 }}>
            每轮限时
          </p>
          <div className="chips">
            {TIME_OPTIONS.map((sec) => (
              <button
                key={sec}
                className={`chip${room.roundSeconds === sec ? ' chip--on' : ''}`}
                onClick={() => setTime(sec)}
                type="button"
              >
                {sec}s
              </button>
            ))}
          </div>
          <p className="lede muted" style={{ fontSize: 12, marginTop: 8 }}>
            到点没交的人不参与判定，按已交的算。
          </p>

          <p className="eyebrow" style={{ margin: '22px 0 10px' }}>
            题目 · 可以不设
          </p>
          <input
            className="field"
            maxLength={16}
            value={themeDraft}
            onChange={(e) => changeTheme(e.target.value)}
            onBlur={flushTheme}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                flushTheme()
                e.currentTarget.blur()
              }
            }}
            placeholder="比如「一种热带水果」，留空就是纯默契"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      ) : (
        <p className="lede muted" style={{ fontSize: 12.5, marginTop: 24 }}>
          每轮限时 {room.roundSeconds} 秒
          {room.theme ? ` · 题目「${room.theme}」` : ' · 没有题目'}
        </p>
      )}

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
