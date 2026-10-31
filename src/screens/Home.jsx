import { useMemo, useState } from 'react'
import Shell from '../components/Shell.jsx'

const NAME_KEY = 'tcxj.name'

function readInvite() {
  try {
    const raw = new URLSearchParams(window.location.search).get('r') || ''
    return raw.replace(/\D/g, '').slice(0, 4)
  } catch {
    return ''
  }
}

function readName() {
  try {
    return localStorage.getItem(NAME_KEY) || ''
  } catch {
    return ''
  }
}

export default function Home({ onCreate, onJoin }) {
  const invite = useMemo(readInvite, [])
  const [mode, setMode] = useState(invite ? 'join' : 'create')
  const [name, setName] = useState(readName)
  const [code, setCode] = useState(invite)

  const trimmed = name.trim()
  const canJoin = trimmed.length > 0 && code.length === 4
  const ready = mode === 'create' ? trimmed.length > 0 : canJoin

  function remember() {
    try {
      if (trimmed) localStorage.setItem(NAME_KEY, trimmed)
    } catch {
      /* 无痕模式写不了，不影响 */
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!ready) return
    remember()
    if (mode === 'create') onCreate(trimmed)
    else onJoin(code, trimmed)
  }

  return (
    <Shell
      center
      sideCenter
      meta="2–16 人 · 两三分钟一局"
      aside={
        <div className="card">
          <div className="tabs">
            <button
              className={`tab${mode === 'create' ? ' tab--on' : ''}`}
              onClick={() => setMode('create')}
              type="button"
            >
              开新局
            </button>
            <button
              className={`tab${mode === 'join' ? ' tab--on' : ''}`}
              onClick={() => setMode('join')}
              type="button"
            >
              进房间
            </button>
          </div>

          <form className="form" onSubmit={handleSubmit}>
            <div>
              <label className="label" htmlFor="nick">
                你的名字
              </label>
              <input
                id="nick"
                className="field"
                maxLength={12}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="随便叫什么都行"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>

            {mode === 'join' ? (
              <div>
                <label className="label" htmlFor="room-code">
                  房号
                </label>
                <input
                  id="room-code"
                  className="field field--code"
                  inputMode="numeric"
                  maxLength={4}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="0000"
                  autoComplete="off"
                />
              </div>
            ) : null}

            <button className="btn" type="submit" disabled={!ready}>
              {mode === 'create' ? '开一局' : '进房间'}
            </button>
          </form>

          <p className="lede muted form__foot" style={{ fontSize: 12 }}>
            {mode === 'create'
              ? '开好之后把房号或链接发给他们。'
              : '房号是 4 位数字，问发起人拿。'}
          </p>
        </div>
      }
    >
      <p className="kicker">默 契 测 试</p>
      <h1 className="hero__title">同词相见</h1>
      <p className="hero__sub">
        几个人同时想一个词，写完才揭晓。
        <br />
        撞上了，才算默契。
      </p>

      <ul className="rules">
        <li>
          <span className="rules__n">01</span>
          没有题面，也没有标准答案
        </li>
        <li>
          <span className="rules__n">02</span>
          每人一个词，谁先交都不影响
        </li>
        <li>
          <span className="rules__n">03</span>
          全员一致，这一局就结束
        </li>
      </ul>
    </Shell>
  )
}
