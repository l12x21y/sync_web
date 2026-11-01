/** 轨道分配逻辑（纯函数版，从 Bubbles.jsx 抽出来便于测） */
export function makeLaneAllocator({ lanes = 6, travel = 9, lead = 1.6 } = {}) {
  const until = new Array(lanes).fill(0)
  return function assign(chat, nowS) {
    if (typeof chat.lane === 'number') return chat
    let pick = 0
    for (let i = 1; i < lanes; i++) if (until[i] < until[pick]) pick = i
    chat.lane = pick
    chat.at = Math.max(nowS, until[pick])
    until[pick] = chat.at + lead
    return chat
  }
}
