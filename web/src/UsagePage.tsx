import { useEffect, useState } from 'react'

type UsageStatus = {
  available: boolean; phase: string; wallet: string; chainId: number;
  source?: string; mining?: string; token?: string; symbol?: string;
  eligible?: string; points?: string; remainder?: string; round?: string; secondsLeft?: number;
  roundPoints?: string; validRounds?: string; budget?: string; reserve?: string;
  unclaimed?: string; paid?: string; balance?: string; total?: string; updatedAt?: string;
  baseline?: { input: number; cached: number; output: number; eligible: number };
  observed?: { input: number; cached: number; output: number; eligible: number };
  history?: { label: string; hash: string; at: string }[];
}

export function UsagePage() {
  const [s, setS] = useState<UsageStatus>()
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const update = async () => {
      try {
        const response = await fetch('/usage-api/status', { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error('unavailable')
        const value = await response.json() as UsageStatus
        if (controller.signal.aborted) return
        setS(value); setError('')
      } catch {
        if (!controller.signal.aborted) setError('本地采集服务不可用，当前数据尚未更新；链上已获得的奖励不受影响。')
      }
    }
    update()
    const timer = setInterval(update, 2000)
    return () => { clearInterval(timer); controller.abort() }
  }, [])
  const num = (value?: string | number) => value === undefined ? '…' : Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 6 })
  const delta = (key: 'input' | 'cached' | 'output') => s?.observed && s.baseline ? s.observed[key] - s.baseline[key] : undefined
  const live = !!s?.round && s.round !== '0'

  return (
    <>
      <p role="status" aria-atomic="true" className={s?.available ? 'ok' : 'mut'}>{error || s?.phase || '连接中…'}</p>
      <div className="card">
        <div className="grid">
          <div className="stat">UBLITZ<b>{num(s?.balance)}</b></div>
          <div className="stat">积分<b>{num(s?.points)}</b></div>
          <div className="stat">轮次<b>{num(s?.validRounds)} / 100</b></div>
          <div className="stat">本轮<b>{live ? `${num(s?.roundPoints)} 分 · ${s?.secondsLeft ?? 0} 秒` : '—'}</b></div>
        </div>
        <p className="sub">新增 token：入 {num(delta('input'))} · 出 {num(delta('output'))} · 结转 {num(s?.remainder)} / 1000</p>
      </div>
      {!!s?.history?.length && (
        <table><tbody>
          {s.history.slice(0, 5).map(item => <tr key={item.hash}><td>{item.label}</td><td className="mono" title={item.hash}>{item.hash.slice(0, 10)}…</td></tr>)}
        </tbody></table>
      )}
    </>
  )
}
