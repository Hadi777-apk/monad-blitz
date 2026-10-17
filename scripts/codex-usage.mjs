import { open, stat } from 'node:fs/promises'

// Only event_msg/token_count aggregate fields leave this parser. Chat text is discarded.
export function usageSnapshot(row) {
  if (row?.type !== 'event_msg' || row?.payload?.type !== 'token_count') return null
  const u = row.payload.info?.total_token_usage
  if (!u) return null
  const fields = ['input_tokens', 'cached_input_tokens', 'output_tokens']
  if (!fields.every(k => Number.isSafeInteger(u[k]) && u[k] >= 0)) return null
  if (u.cached_input_tokens > u.input_tokens) return null
  const eligible = u.input_tokens - u.cached_input_tokens + u.output_tokens
  if (!Number.isSafeInteger(eligible)) return null
  // reasoning_output_tokens are already included in output_tokens; do not count twice.
  return { input: u.input_tokens, cached: u.cached_input_tokens, output: u.output_tokens, eligible }
}

export class CodexUsageReader {
  constructor(path) { this.path = path; this.offset = 0; this.identity = null; this.latest = null }
  async poll() {
    const s = await stat(this.path)
    const identity = `${s.dev}:${s.ino}`
    if ((this.identity && identity !== this.identity) || s.size < this.offset) {
      throw new Error('用量文件被替换或截断，已停止计奖；需要重新核对数据源。')
    }
    this.identity = identity
    if (s.size === this.offset) return this.latest
    const handle = await open(this.path, 'r')
    try {
      // Bounded chunks; incomplete JSON lines are reread on the next poll.
      let pending = Buffer.alloc(0)
      let readOffset = this.offset
      let committedOffset = this.offset
      while (readOffset < s.size) {
        const b = Buffer.alloc(Math.min(256 * 1024, s.size - readOffset))
        const { bytesRead } = await handle.read(b, 0, b.length, readOffset)
        if (!bytesRead) break
        readOffset += bytesRead
        const combined = Buffer.concat([pending, b.subarray(0, bytesRead)])
        const end = combined.lastIndexOf(10)
        if (end >= 0) {
          for (const line of combined.subarray(0, end).toString('utf8').split('\n')) {
            if (!line.includes('"token_count"')) continue
            let row
            try { row = JSON.parse(line) } catch { continue }
            const value = usageSnapshot(row)
            if (!value) continue
            if (this.latest && (value.input < this.latest.input || value.cached < this.latest.cached
              || value.output < this.latest.output || value.eligible < this.latest.eligible)) {
              throw new Error('用量累计值回退，已停止计奖；不会把重置当成新增用量。')
            }
            this.latest = value
          }
          committedOffset = readOffset - (combined.length - end - 1)
          pending = combined.subarray(end + 1)
        } else pending = combined
      }
      this.offset = committedOffset
      return this.latest
    } finally { await handle.close() }
  }
}
