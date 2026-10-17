import { useCallback, useEffect, useRef, useState } from 'react'
import { formatEther, type Address } from 'viem'
import type { Ctx } from './wallet'
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
      setErr(e.shortMessage ?? e.message)
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
    try { await fn(); await refresh() } catch (e: any) { setErr(e.message) } finally { setBusy('') }
  }

  const secondsLeft = round ? Number(round.deadline) - now : 0
  const expired = !!round && secondsLeft <= 0

  const startSolver = () => {
    if (!account || !round) return
    if (!consented.current && !confirm('Run SHA-256 puzzle solving in your browser (CPU load, stoppable at any time)?')) return
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
        log(`answer found locally (nonce ${ev.data.nonce}) — not accepted until the transaction confirms`)
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

  const fmt = (v?: bigint) => (v === undefined ? '…' : Number(formatEther(v)).toLocaleString(undefined, { maximumFractionDigits: 6 }))

  return (
    <>
      <div className="card">
        <h2>Pool A · 800 BLITZ</h2>
        <div className="grid">
          <div className="stat">Valid rounds<b>{String(s.validRounds ?? '…')} / 100</b></div>
          <div className="stat">Available budget<b>{fmt(s.remainingA)}</b></div>
          <div className="stat">Open reserve<b>{fmt(s.openReserveA)}</b></div>
          <div className="stat">Closed, unclaimed<b>{fmt(s.closedUnclaimedA)}</b></div>
          <div className="stat">Paid out<b>{fmt(s.paidA)}</b></div>
          <div className="stat">Group B<b>200 · permanently locked</b></div>
        </div>
        <p className="sub">Your BLITZ: <b>{fmt(blitzBal)}</b> · difficulty {bits} leading zero bits</p>
      </div>

      <div className="card">
        <h2>Current round</h2>
        {openId === 0n ? (
          <>
            <p className="mut">No round is open.</p>
            <button disabled={!!busy || !account} onClick={act('open', () => write(mining, 'Mining', 'openRound'))}>
              {busy === 'open' ? 'Opening…' : 'Open round (reserves 8 BLITZ)'}
            </button>
          </>
        ) : (
          <>
            <div className="grid">
              <div className="stat">Round<b>#{String(openId)}</b></div>
              <div className="stat">Accepted answers<b>{round?.totalPoints ?? 0}</b></div>
              <div className="stat">{expired ? 'Ended' : 'Time left'}<b>{expired ? 'ready to close' : `${secondsLeft}s`}</b></div>
            </div>
            <div className="row">
              {solver !== 'running' ? (
                <button disabled={expired || !account || !!busy} onClick={startSolver}>Start solving</button>
              ) : (
                <button className="sec" onClick={stopSolver}>Stop</button>
              )}
              {solver === 'running' && <span className="mut">searching… {Number(tried).toLocaleString()} nonces tried</span>}
              {solver === 'found' && found && (
                <button
                  disabled={!!busy || expired}
                  onClick={act('submit', async () => { await write(mining, 'Mining', 'submit', [BigInt(found)]); setSolver('idle'); setFound(undefined) })}
                >
                  {busy === 'submit' ? 'Submitting…' : 'Submit answer (1 point)'}
                </button>
              )}
              <button className="sec" disabled={!expired || !!busy} onClick={act('close', () => write(mining, 'Mining', 'closeRound'))}>
                {busy === 'close' ? 'Closing…' : 'Close round'}
              </button>
            </div>
            <p className="sub">An answer counts only once its transaction is confirmed. Local speed never earns points.</p>
          </>
        )}
        {err && <p className="bad">{err}</p>}
      </div>

      <div className="card">
        <h2>Your contributions</h2>
        {!account ? <p className="mut">Connect a wallet.</p> : mine.length === 0 ? <p className="mut">None yet.</p> : (
          <table>
            <thead><tr><th>#</th><th>Round</th><th>Reward</th><th /></tr></thead>
            <tbody>
              {mine.map((c) => (
                <tr key={c.id}>
                  <td>{c.id}</td><td>{c.round}</td>
                  <td>{c.closed ? fmt(c.reward) : 'pending (round open)'}</td>
                  <td>
                    {c.claimed ? <span className="ok">claimed</span> : (
                      <button disabled={!c.closed || !!busy} onClick={act('claim', () => write(mining, 'Mining', 'claim', [BigInt(c.id)]))}>Claim</button>
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
              Claim all
            </button>
          </div>
        )}
      </div>
    </>
  )
}
