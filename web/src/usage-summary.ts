export type UsageSource = { id: string; label: string; total: number; eligible: number; quality: 'recorded' | 'estimated' }
export type UsageSummary = { schema: string; machineId: string; collectedAt: string; sources: UsageSource[]; totals: { total: number; eligible: number }; coverage?: { supported: number; found: number } }
export type UsageBaseline = { createdAt: string; sources: Record<string, { high: number; earned: number }> }
const validCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
export function validateSummary(value: unknown): UsageSummary {
  const s = value as UsageSummary
  if (s?.schema !== 'blitz-ai-usage/v1' || !/^[a-zA-Z0-9-]{16,80}$/.test(s.machineId) || !Array.isArray(s.sources) || s.sources.length > 100) throw new Error('请选择本机采集器导出的 AI 用量报告。')
  const seen = new Set<string>(); let total = 0; let eligible = 0
  for (const row of s.sources) {
    if (!/^[a-z0-9-]{1,40}$/.test(row.id) || ['constructor','prototype'].includes(row.id) || seen.has(row.id) || typeof row.label !== 'string' || row.label.length > 80 || !validCount(row.total) || !validCount(row.eligible) || row.eligible > row.total || !['recorded','estimated'].includes(row.quality) || (row.quality === 'estimated' && row.eligible !== 0)) throw new Error('统计来源或数值无效，未更新本机起点。')
    seen.add(row.id); total += row.total; eligible += row.eligible
  }
  if (!validCount(total) || !validCount(eligible) || total !== s.totals?.total || eligible !== s.totals?.eligible) throw new Error('统计合计不一致，未更新本机起点。')
  return s
}
export function updateBaseline(summary: UsageSummary, previous?: UsageBaseline) {
  const next: UsageBaseline = previous ? JSON.parse(JSON.stringify(previous)) : { createdAt: new Date().toISOString(), sources: {} }
  if (!next.sources || Object.values(next.sources).some(s => !s || !validCount(s.high) || !validCount(s.earned))) throw new Error('本机起点损坏，请先核对浏览器保存的统计记录。')
  const rollback: string[] = []
  for (const s of summary.sources) {
    const old = Object.hasOwn(next.sources, s.id) ? next.sources[s.id] : undefined
    if (!old) next.sources[s.id] = { high: s.eligible, earned: 0 }
    else if (s.eligible < old.high) rollback.push(s.label)
    else { old.earned += s.eligible - old.high; old.high = s.eligible }
  }
  const earned = Object.values(next.sources).reduce((sum, s) => sum + s.earned, 0)
  if (!validCount(earned)) throw new Error('新增统计超出安全整数范围。')
  return { next, earned, rollback, first: !previous }
}
