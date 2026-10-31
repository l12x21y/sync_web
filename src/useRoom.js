import { useCallback, useEffect, useRef, useState } from 'react'

const STORE_KEY = 'gzh.session'

function readSession() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    if (!s || !s.code || !s.playerId) return null
    return s
  } catch {
    return null
  }
}

function writeSession(code, playerId) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ code, playerId }))
  } catch {
    /* 隐私模式下写不了，不影响这一局 */
  }
}

function clearSession() {
  try {
    localStorage.removeItem(STORE_KEY)
  } catch {
    /* ignore */
  }
}

function inviteCode() {
  try {
    return (new URLSearchParams(window.location.search).get('r') || '')
      .replace(/\D/g, '')
      .slice(0, 4)
  } catch {
    return ''
  }
}

/**
 * 打开带 ?r=房号 的邀请链接时，优先听那条链接的。
 * 本地存的是别的房间的座位就丢掉，免得点进朋友的房间却被拽回上一局。
 */
function initialSession() {
  const saved = readSession()
  if (!saved) return null
  const want = inviteCode()
  if (want && want !== saved.code) {
    clearSession()
    return null
  }
  return saved
}

const bootSession = initialSession()

function wsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws`
}

export function useRoom() {
  const [room, setRoom] = useState(null)
  const [myId, setMyId] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('idle')
  const [booting, setBooting] = useState(Boolean(bootSession))

  const wsRef = useRef(null)
  const openRef = useRef(null)
  const idRef = useRef(null)
  const retryRef = useRef(null)
  const closedRef = useRef(false)

  const connect = useCallback(() => {
    if (openRef.current) return openRef.current

    const promise = new Promise((resolve, reject) => {
      let settled = false
      const ws = new WebSocket(wsUrl())
      wsRef.current = ws
      setStatus('connecting')

      ws.onopen = () => {
        settled = true
        setStatus('open')
        resolve(ws)

        // 刷新页面 / 断线重连：沿用原来的座位
        const saved = readSession()
        if (saved) {
          ws.send(
            JSON.stringify({ type: 'rejoin', code: saved.code, playerId: saved.playerId }),
          )
        }
      }

      ws.onerror = () => {
        if (!settled) {
          settled = true
          reject(new Error('connect-failed'))
        }
      }

      ws.onclose = () => {
        setStatus('closed')
        openRef.current = null
        if (closedRef.current) return
        if (idRef.current) {
          retryRef.current = window.setTimeout(() => {
            connect().catch(() => {})
          }, 1600)
        }
      }

      ws.onmessage = (ev) => {
        let msg
        try {
          msg = JSON.parse(ev.data)
        } catch {
          return
        }
        if (msg.type === 'state') {
          setRoom(msg.room)
          setBooting(false)
        } else if (msg.type === 'joined') {
          idRef.current = msg.playerId
          setMyId(msg.playerId)
          setRoom(msg.room)
          setBooting(false)
          writeSession(msg.room.code, msg.playerId)
        } else if (msg.type === 'left') {
          clearSession()
          idRef.current = null
          setMyId(null)
          setRoom(null)
        } else if (msg.type === 'error') {
          setError(msg.message)
          if (/房间没了|座位没了/.test(msg.message)) {
            clearSession()
            idRef.current = null
            setMyId(null)
            setRoom(null)
            setBooting(false)
          }
        }
      }
    })

    openRef.current = promise
    return promise
  }, [])

  const send = useCallback(
    async (payload) => {
      try {
        const ws = await connect()
        ws.send(JSON.stringify(payload))
      } catch {
        setError('连不上服务器，检查一下网络')
      }
    },
    [connect],
  )

  const resetLocal = useCallback(() => {
    clearSession()
    idRef.current = null
    setMyId(null)
    setRoom(null)
  }, [])

  const create = useCallback(
    async (name) => {
      resetLocal()
      await send({ type: 'create', name })
    },
    [resetLocal, send],
  )

  const join = useCallback(
    async (code, name) => {
      resetLocal()
      await send({ type: 'join', code, name })
    },
    [resetLocal, send],
  )

  const leave = useCallback(async () => {
    await send({ type: 'leave' })
    resetLocal()
  }, [send, resetLocal])

  const start = useCallback(() => send({ type: 'start' }), [send])
  const submit = useCallback((word) => send({ type: 'submit', word }), [send])
  const next = useCallback(() => send({ type: 'next' }), [send])
  const again = useCallback(() => send({ type: 'again' }), [send])
  const updateSettings = useCallback(
    (patch) => send({ type: 'settings', ...patch }),
    [send],
  )

  // 恢复会话时别一直卡在启动页
  useEffect(() => {
    if (!booting) return undefined
    const t = window.setTimeout(() => setBooting(false), 2600)
    return () => window.clearTimeout(t)
  }, [booting])

  // 首次挂载：本地有座位就自动续上
  useEffect(() => {
    if (bootSession) {
      connect().catch(() => setBooting(false))
    }
    return () => {
      closedRef.current = true
      window.clearTimeout(retryRef.current)
      if (wsRef.current) wsRef.current.close()
    }
  }, [connect])

  useEffect(() => {
    if (!error) return undefined
    const t = window.setTimeout(() => setError(''), 3200)
    return () => window.clearTimeout(t)
  }, [error])

  return {
    room,
    myId,
    error,
    status,
    booting,
    isHost: Boolean(room && myId && room.hostId === myId),
    create,
    join,
    start,
    submit,
    next,
    again,
    updateSettings,
    leave,
  }
}
