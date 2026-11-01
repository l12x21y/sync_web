import { useMemo, useState } from 'react'
import { buildText, buildImage, downloadCanvas, copyText, isMobileDevice, openSaveSheet } from '../share.js'
import { describeDistance } from '../../shared/distance.js'

export default function ShareCard({ rounds, players, theme, distance = 0, onClose }) {
  const [flash, setFlash] = useState('')

  const safeRounds = useMemo(() => rounds.filter((r) => (r.groups || []).length > 0), [rounds])
  const meta = useMemo(() => ({ players, theme, distance }), [players, theme, distance])
  const text = useMemo(() => buildText(safeRounds, meta), [safeRounds, meta])
  const dist = distance > 0 ? describeDistance(distance) : null

  async function handleCopy() {
    const ok = await copyText(text)
    setFlash(ok ? '文字已复制，粘到哪儿都行' : '复制没成功，试试存成图片')
    window.setTimeout(() => setFlash(''), 2200)
  }

  function handleImage() {
    try {
      const canvas = buildImage(safeRounds, meta)
      // 手机上 a[download] 会被忽略（微信/iOS Safari），改成浮层里长按保存
      if (isMobileDevice()) {
        openSaveSheet(canvas, 'RESONANCE-record.png')
        setFlash('')
        return
      }
      downloadCanvas(canvas, 'RESONANCE-record.png')
      setFlash('图片已存到下载文件夹')
    } catch {
      setFlash('出图失败，改用复制文字吧')
    }
    window.setTimeout(() => setFlash(''), 2200)
  }

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="对局记录">
      <div className="sheet__panel">
        <header className="sheet__head">
          <div>
            <p className="eyebrow">GAME RECORD</p>
            <h2 className="sheet__title">对局记录</h2>
          </div>
          <button className="sheet__x" onClick={onClose} type="button" aria-label="关掉">
            ✕
          </button>
        </header>

        <div className="sheet__body">
          {theme ? (
            <p className="lede muted" style={{ fontSize: 12.5, padding: '12px 0 0' }}>
              题目「{theme}」
            </p>
          ) : null}
          {safeRounds.map((r, i) => {
            const rows = (r.groups || []).flatMap((g) =>
              (g.names || []).map((name) => ({ name, word: g.word })),
            )
            return (
              <section className="log" key={`${r.round}-${i}`}>
                <div className="log__head">
                  <span className="log__n">ROUND {String(r.round || i + 1).padStart(2, '0')}</span>
                  {r.allSame ? <span className="log__tag">对上了</span> : null}
                  {!r.allSame && r.timedOut ? <span className="log__tag">时间到</span> : null}
                </div>
                <ul className="log__list">
                  {rows.map((row, k) => (
                    <li className="log__row" key={`${row.name}-${k}`}>
                      <span className="log__name">{row.name}</span>
                      <span className="log__word">{row.word}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
          {dist ? (
            <section className="log log--dist">
              <div className="log__head">
                <span className="log__n">DISTANCE · 默契里程</span>
              </div>
              <p className="dist__big">{dist.fmt}</p>
              <p className="dist__quips">{dist.quips.join(' · ')}</p>
            </section>
          ) : null}
        </div>

        <footer className="sheet__foot">
          <div className="btn-row">
            <button className="btn btn--ghost btn--sm" onClick={handleCopy} type="button">
              复制文字
            </button>
            <button className="btn btn--sm" onClick={handleImage} type="button">
              存成图片
            </button>
          </div>
          {flash ? <p className="sheet__flash">{flash}</p> : null}
        </footer>
      </div>
    </div>
  )
}
