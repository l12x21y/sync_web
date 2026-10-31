import { useState } from 'react'

const MAX_CHAT_LEN = 30

/** 底部那条细输入：一句话的事，回车或点「发」就冒出去。 */
export default function ChatBar({ onSend }) {
  const [draft, setDraft] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    const t = draft.trim()
    if (!t) return
    onSend(t.slice(0, MAX_CHAT_LEN))
    setDraft('')
  }

  return (
    <form className="chatbar" onSubmit={handleSubmit}>
      <input
        className="chatbar__input"
        value={draft}
        maxLength={MAX_CHAT_LEN}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="冒个泡…"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="发一句话"
      />
      <button className="chatbar__go" type="submit" disabled={!draft.trim()}>
        发
      </button>
    </form>
  )
}
