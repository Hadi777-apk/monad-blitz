import { useCallback, useEffect, useRef, useState } from 'react'
import { formatEther, type Address } from 'viem'
import type { Ctx } from './wallet'
import { errorMessage } from './messages'
import MinerWorker from './miner.worker?worker'

type Round = { seed: `0x${string}`; openedAt: bigint; deadline: bigint; totalPoints: number; closed: boolean; reserved: bigint }
type Contribution = { id: number; round: number; start: number; claimed: boolean; reward?: bigint; closed: boolean }

export function MinerPage({ ctx }: { ctx: Ctx }) {
  const { dep, account, pub, read, write, log } = ctx
  const mining = dep!.mining as Address
  const [s, setS] = useState<Record<string, bigint>>({})
  const [bits, setBits] = useState(0)
  const [openId, setOpenId] = useState(0n)
  const [round, setRound] = useState<Round>()
  const [mine, setMine] = useState<Contribution[]>([])
  const [blitzBal, setBlitzBal] = useState(0n)
  const [now, setNow] = useState(0)
  const [busy, setBusy] = useState('')
  const [solver, setSolver] = useState<'idle' | 'running' | 'found'>('idle')
  const [tried, setTried] = useState('0')
  const [found, setFound] = useState<string>()
  const [err, setErr] = useState('')
  const worker = useRef<Worker>()
  const consented = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const keys = ['remainingA', 'openReserveA', 'closedUnclaimedA', 'paidA', 'validRounds', 'roundCount'] as const
      const vals = await Promise.all(keys.map((k) => read<bigint>(mining, 'Mining', k)))
      setS(Object.fromEntries(keys.map((k, i) => [k, vals[i]])))
      setBits(Number(await read(mining, 'Mining', 'difficultyBits')))
      const id = await read<bigint>(mining, 'Mining', 'openRoundId')
      setOpenId(id)
      if (id !== 0n) {
        const r = await read<any>(mining, 'Mining', 'rounds', [id])
        setRound({ seed: r[0], openedAt: r[1], deadline: r[2], totalPoints: r[3], closed: r[4], reserved: r[5] })
      } else setRound(undefined)
      setNow(Number((await pub.getBlock()).timestamp))
      if (account) {
        setBlitzBal(await read<bigint>(dep!.blitz as Address, 'BLITZ', 'balanceOf', [account]))
        // Scan the contributions list for this wallet (demo scale; an indexer is optional and not required)
        const n = Number(await read<bigint>(mining, 'Mining', 'contributionCount'))
        const out: Contribution[] = []
        for (let i = 0; i < n; i++) {
          const c = await read<any>(mining, 'Mining', 'contributions', [BigInt(i)])
          if (c[0].toLowerCase() !== account.toLowerCase()) continue
          const rd = await read<any>(mining, 'Mining', 'rounds', [BigInt(c[1])])
          const closed = rd[4] as boolean
          out.push({
            id: i, round: Number(c[1]), start: Number(c[2]), claimed: c[3], closed,
            reward: closed ? await read<bigint>(mining, 'Mining', 'rewardOf', [BigInt(i)]) : undefined,
          })
        }
        setMine(out)
      }
    } catch (e: any) {
      setErr(errorMessage(e))
    }
  }, [account, mining, pub, read, dep])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 4000)
    return () => clearInterval(t)
  }, [refresh])
  useEffect(() => {
    const t = setInterval(() => setNow((n) => (n ? n + 1 : n)), 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => () => worker.current?.terminate(), [])

  const act = (label: string, fn: () => Promise<void>) => async () => {
    setBusy(label)
    setErr('')
    try { await fn(); await refresh() } catch (e: any) { setErr(errorMessage(e)) } finally { setBusy('') }
  }

  const secondsLeft = round ? Number(round.deadline) - now : 0
  const expired = !!round && secondsLeft <= 0

  const startSolver = () => {
    if (!account || !round) return
    if (!consented.current && !confirm('是否在浏览器中运行 SHA-256 算题？这会占用处理器资源，你可以随时停止。')) return
    consented.current = true
    worker.current?.terminate()
    const w = new MinerWorker()
    worker.current = w
    setFound(undefined)
    setTried('0')
    setSolver('running')
    w.onmessage = (ev: MessageEvent) => {
      if (ev.data.type === 'progress') setTried(ev.data.tried)
      if (ev.data.type === 'found') {
        setFound(ev.data.nonce)
        setSolver('found')
        log(`已在本地找到答案（随机数 ${ev.data.nonce}），交易确认后才计分`)
      }
    }
    w.postMessage({
      type: 'start',
      params: { chainId: ctx.chainId, mining, round: openId.toString(), seed: round.seed, miner: account },
      bits,
      // start from a random offset so two tabs on one wallet do not duplicate work
      startNonce: BigInt(Math.floor(Math.random() * 2 ** 48)).toString(),
    })
  }
  const stopSolver = () => {
    worker.current?.postMessage({ type: 'stop' })
    worker.current?.terminate()
    setSolver('idle')
  }
  // Pause when the tab is hidden
  useEffect(() => {
    const f = () => document.hidden && solver === 'running' && stopSolver()
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  })

  const fmt = (v?: bigint) => (v === undefined ? '…' : Number(formatEther(v)).toLocaleString('zh-CN', { maximumFractionDigits: 6 }))

  return (
    <>
      <div className="card">
        <div className="grid">
          <div className="stat">我的 BLITZ<b>{fmt(blitzBal)}</b></div>
          <div className="stat">可用预算<b>{fmt(s.remainingA)}</b></div>
          <div className="stat">有效轮次<b>{String(s.validRounds ?? '…')} / 100</b></div>
        </div>
      </div>

      <div className="card">
        {openId === 0n ? (
          <>
            <button disabled={!!busy || !account} onClick={act('open', () => write(mining, 'Mining', 'openRound'))}>
              {busy === 'open' ? '正在开启…' : '开启一轮（预留 8 BLITZ）'}
            </button>
          </>
        ) : (
          <>
            <div className="grid">
              <div className="stat">轮次<b>#{String(openId)}</b></div>
              <div className="stat">已接受答案<b>{round?.totalPoints ?? 0}</b></div>
              <div className="stat">{expired ? '已到期' : '剩余时间'}<b>{expired ? '可结算' : `${secondsLeft} 秒`}</b></div>
            </div>
            <div className="row">
              {solver !== 'running' ? (
                <button disabled={expired || !account || !!busy} onClick={startSolver}>开始算题</button>
              ) : (
                <button className="sec" onClick={stopSolver}>停止算题</button>
              )}
              {solver === 'running' && <span className="mut">正在算题… 已尝试 {Number(tried).toLocaleString('zh-CN')} 个随机数</span>}
              {solver === 'found' && found && (
                <button
                  disabled={!!busy || expired}
                  onClick={act('submit', async () => { await write(mining, 'Mining', 'submit', [BigInt(found)]); setSolver('idle'); setFound(undefined) })}
                >
                  {busy === 'submit' ? '正在提交…' : '提交答案（1 分）'}
                </button>
              )}
              <button className="sec" disabled={!expired || !!busy} onClick={act('close', () => write(mining, 'Mining', 'closeRound'))}>
                {busy === 'close' ? '正在结算…' : '结算本轮'}
              </button>
            </div>
          </>
        )}
        {err && <p className="bad" role="alert">{err}</p>}
      </div>

      {mine.length > 0 && <div className="card">
        {(
          <table>
            <thead><tr><th>编号</th><th>轮次</th><th>奖励</th><th /></tr></thead>
            <tbody>
              {mine.map((c) => (
                <tr key={c.id}>
                  <td>{c.id}</td><td>{c.round}</td>
                  <td>{c.closed ? fmt(c.reward) : '待结算（本轮进行中）'}</td>
                  <td>
                    {c.claimed ? <span className="ok">已领取</span> : (
                      <button disabled={!c.closed || !!busy} onClick={act('claim', () => write(mining, 'Mining', 'claim', [BigInt(c.id)]))}>领取</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {mine.some((c) => c.closed && !c.claimed) && (
          <div className="row">
            <button className="sec" disabled={!!busy} onClick={act('claimAll', () => write(mining, 'Mining', 'claimMany', [mine.filter((c) => c.closed && !c.claimed).map((c) => BigInt(c.id))]))}>
              全部领取
            </button>
          </div>
        )}
      </div>}
    </>
  )
}
