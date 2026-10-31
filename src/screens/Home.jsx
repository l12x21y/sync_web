import { useMemo, useState } from 'react'
import Shell from '../components/Shell.jsx'

const NAME_KEY = 'gzh.name'

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
      meta="2–16 人 / 一局两三分钟"
      aside={
        <div className="card">
          <div className="tabs">
            <button
              className={`tab${mode === 'create' ? ' tab--on' : ''}`}
              onClick={() => setMode('create')}
              type="button"
            >
              自己开一间
            </button>
            <button
              className={`tab${mode === 'join' ? ' tab--on' : ''}`}
              onClick={() => setMode('join')}
              type="button"
            >
              进别人的
            </button>
          </div>

          <form className="form" onSubmit={handleSubmit}>
            <div>
              <label className="label" htmlFor="nick">
                怎么称呼你
              </label>
              <input
                id="nick"
                className="field"
                maxLength={12}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="随便写，能认出来就行"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>

            {mode === 'join' ? (
              <div>
                <label className="label" htmlFor="room-code">
                  房间号
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
              {mode === 'create' ? '开一间' : '进去'}
            </button>
          </form>

          <p className="lede muted form__foot" style={{ fontSize: 12 }}>
            {mode === 'create'
              ? '开好之后，把房间号或者链接丢到群里喊人。'
              : '四位数，问拉你进来的人要。'}
          </p>
        </div>
      }
    >
      <p className="kicker">SAME MOMENT · ONE WORD</p>
      <h1 className="hero__title">RESONANCE</h1>
      <p className="hero__cn">共振</p>
      <p className="hero__sub">
        同一时间，几个人各自写下一个词。
        <br />
        全部一样，才说明你们想的是一件事。
      </p>

      <ul className="rules">
        <li>
          <span className="rules__n">01</span>
          没有题目，也没有参考答案
        </li>
        <li>
          <span className="rules__n">02</span>
          各写各的，交齐之前谁也看不见
        </li>
        <li>
          <span className="rules__n">03</span>
          全对上了就散局，对不上就再写一次
        </li>
      </ul>
    </Shell>
  )
}
