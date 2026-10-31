/**
 * 判定两个词是否"同一个词"的唯一口径。
 * 规则：去首尾空白 → 全角转半角 → 小写 → 去掉所有空白 → 去掉所有标点符号。
 * 只做字符层面归一，"苹果"和"红苹果"依然算不同。
 */
export function normalizeWord(raw) {
  if (typeof raw !== 'string') return ''
  let s = raw.trim()
  // 全角 ASCII → 半角
  s = s.replace(/[\uFF01-\uFF5E]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  )
  s = s.replace(/\u3000/g, ' ')
  s = s.toLowerCase()
  s = s.replace(/\s+/g, '')
  // 保留字母、数字、汉字，其余（标点/符号/emoji）全部丢弃
  s = s.replace(/[^\p{L}\p{N}]/gu, '')
  return s
}

/** 送进游戏前的原始输入清洗：只 trim，保留玩家原本的写法用于展示。 */
export function displayWord(raw) {
  if (typeof raw !== 'string') return ''
  return raw.replace(/\s+/g, ' ').trim()
}
