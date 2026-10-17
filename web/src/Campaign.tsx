import { useCallback, useEffect, useState } from 'react'
import { formatUnits, isAddress, type Address } from 'viem'
import { campaignAbi as abi, cfg, erc20Abi, factoryAbi, pub, sendTx, short, M, hms, phaseOf, PHASES, useTick } from './lib'
import { validateSummary } from './usage-summary'
import { errorMessage } from './messages'
import { rankingRows } from './demo-ranking'

type Row = { wallet: Address; usage: bigint }
type State = {
  now: number; registerEnd: number; reportEnd: number; claimEnd: number
  pool: bigint; total: bigint; count: number; symbol: string; decimals: number; creator: Address; rows: Row[]
  demo: boolean; controller?: Address
  me?: { registered: boolean; usage: bigint; claimed: boolean }
}

export function Campaign({ addr, account, connect }: { addr: Address; account?: Address; connect: () => Promise<void> }) {
  const [s, setS] = useState<State>()
  const [msg, setMsg] = useState(''), [busy, setBusy] = useState(false), [scanning, setScanning] = useState(false)
  const [mine, setMine] = useState<number>()
  const [lookup, setLookup] = useState('')
  const [found, setFound] = useState<{ registered: boolean; usage: bigint; rank: number }>()
  const tick = useTick()

  const read = useCallback((functionName: string, args: unknown[] = []) =>
    pub().readContract({ address: addr, abi, functionName, args } as any) as Promise<any>, [addr])

  const refresh = useCallback(async () => {
    const p = pub()
    const [reg, rep, claim, finalized, total, count, block, token, creator] = await Promise.all([
      read('registerEnd'), read('reportEnd'), read('claimEnd'), read('finalized'), read('totalUsage'),
      read('participantCount'), p.getBlock(), read('token'), read('treasury'),
    ])
    const [pool, symbol, decimals] = await Promise.all([
      finalized ? read('pool') : p.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [addr] }),
      p.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
      p.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
    ])
    const wallets: Address[] = []
    for (let o = 0; o < Math.min(Number(count), 200); o += 50) wallets.push(...await read('participants', [BigInt(o), 50n]))
    const rows = (await Promise.all(wallets.map(async (wallet) => ({ wallet, usage: await read('usage', [wallet]) as bigint }))))
      .sort((a, b) => (a.usage === b.usage ? 0 : a.usage > b.usage ? -1 : 1))
    const me = account
      ? { registered: await read('registered', [account]) as boolean, usage: await read('usage', [account]) as bigint, claimed: await read('claimed', [account]) as boolean }
      : undefined
    // Demo campaigns let their creator skip the clock; the directory says which ones they are.
    const demo = cfg.factory ? await p.readContract({ address: cfg.factory as Address, abi: factoryAbi, functionName: 'isDemo', args: [addr] }) as boolean : false
    const controller = demo ? await read('controller') as Address : undefined
    setS({ now: Number(block.timestamp), registerEnd: Number(reg), reportEnd: Number(rep), claimEnd: Number(claim), pool: pool as bigint, total, count: Number(count), symbol: symbol as string, decimals: Number(decimals), creator, rows, me, demo, controller })
  }, [read, addr, account])

  useEffect(() => {
    refresh().catch((e) => setMsg(errorMessage(e)))
    const t = setInterval(() => refresh().catch(() => {}), 8000)
    return () => clearInterval(t)
  }, [refresh])

  // Look up any wallet's standing by address.
  useEffect(() => {
    setFound(undefined)
    if (!isAddress(lookup) || !s) return
    let live = true
    Promise.all([read('registered', [lookup]), read('usage', [lookup])]).then(([registered, usage]) => {
      if (live) setFound({ registered, usage, rank: registered ? s.rows.filter((x) => x.usage > usage).length + 1 : 0 })
    }).catch(() => {})
    return () => { live = false }
  }, [lookup, s, read])

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true); setMsg('')
    try { await fn(); await refresh() } catch (e) { setMsg(errorMessage(e)) } finally { setBusy(false) }
  }
  const act = (fn: 'register' | 'report' | 'claim' | 'skip', args: unknown[] = []) => run(async () => {
    if (!account) throw new Error('请先连接钱包。')
    await sendTx(account, addr, abi, fn, args)
  })
  const accept = (value: unknown) => setMine(validateSummary(value).totals.total)
  const scan = async () => {
    setScanning(true); setMsg('')
    try {
      const res = await fetch('http://127.0.0.1:8788/summary', { cache: 'no-store', signal: AbortSignal.timeout(125000) })
      if (!res.ok) throw new Error('本机统计服务暂不可用，请打开采集器后重试。')
      accept(await res.json())
    } catch (e) { setMsg(e instanceof TypeError ? '没有连上本机采集器：先运行采集器，或下载报告后导入。' : errorMessage(e)) } finally { setScanning(false) }
  }
  const importReport = async (f?: File) => {
    if (!f) return
    setMsg('')
    try { if (f.size > 2e6) throw new Error('请导入采集器生成的小型统计报告，不要选择聊天原始日志。'); accept(JSON.parse(await f.text())) } catch (e) { setMsg(errorMessage(e)) }
  }

  if (!s) return <p className="mut">{msg || '加载中…'}</p>

  const now = s.now + tick, phase = phaseOf(now, s)
  const until = [s.registerEnd, s.reportEnd, s.claimEnd][phase] - now
  const fmt = (n: bigint) => Number(formatUnits(n, s.decimals)).toLocaleString('zh-CN', { maximumFractionDigits: 4 })
  const shareOf = (u: bigint) => (s.total > 0n ? s.pool * u / s.total : 0n)
  const pct = (u: bigint) => (s.total > 0n ? Number(u * 10000n / s.total) / 100 : 0)
  const steps = ['报名', '上报', '领取']
  const me = s.me
  const canReport = phase === 1 && !!me?.registered && mine !== undefined && BigInt(mine) > me.usage
  const myRank = me?.registered && me.usage > 0n ? s.rows.findIndex((x) => x.wallet.toLowerCase() === account!.toLowerCase()) + 1 : 0
  const board = rankingRows(addr, s.rows, s.demo)
  const boardTotal = board.reduce((total, row) => total + row.usage, 0n)
  const boardPct = (usage: bigint) => boardTotal > 0n ? Number(usage * 10000n / boardTotal) / 100 : 0

  const hint = !account ? '先点右上角“连接钱包”。'
    : phase === 3 ? '活动已结束。'
    : !me?.registered ? (phase === 0 ? '点“报名参加”。报名后才能上报用量。' : '报名已结束，这个钱包没有报名。')
    : phase === 0 ? (mine === undefined
      ? `已报名。现在可以先下载采集器并点“读取本机用量”试一下；上报期在 ${hms(until)} 后开始，持续 ${hms(s.reportEnd - s.registerEnd)}。`
      : `已读取。上报要等上报期（${hms(until)} 后开始），到时请再读取一次，数字才是最新的。`)
    : phase === 1 ? (me.usage === 0n ? '点“读取本机用量”，再点“上报”。' : mine === undefined ? '已上报。想更新可再读取一次。' : '已读取。点“上报”提交。')
    : me.claimed ? '已领取。' : me.usage > 0n ? '点“领取”拿走你的份额。' : '你没有上报用量，没有可领取的奖励。'

  return (
    <>
      <section className="hero">
        <div className="label">奖池</div>
        <div className="big">{fmt(s.pool)}<span>{s.symbol}</span></div>
        <ol className="steps">{steps.map((n, i) => <li key={n} className={i < phase ? 'done' : i === phase ? 'on' : ''}>{n}</li>)}</ol>
        <div className="when">{phase < 3 ? <>{PHASES[phase]} · 剩余 <b>{hms(until)}</b></> : '活动已结束'}</div>
      </section>

      <p className="hint">{hint}</p>

      {s.demo && <p className="sub">创建者可以随时提前结束当前阶段。</p>}
      {s.demo && account && s.controller?.toLowerCase() === account.toLowerCase() && phase < 3 &&
        <button className="skipfab" disabled={busy} onClick={act('skip')} title="立刻结束当前阶段，进入下一阶段">
          {busy ? '处理中…' : `跳过 ›  ${['结束报名', '结束上报', '结束领取'][phase]}`}
        </button>}

      <section className="stats">
        <div><span>{s.demo ? '链上报名' : '已报名'}</span><b>{s.count.toLocaleString('zh-CN')}</b></div>
        <div><span>{s.demo ? '链上总用量' : '总用量'}</span><b>{M(s.total)}</b></div>
        <div><span>{s.demo ? '我的链上排名' : '我的排名'}</span><b>{myRank ? `#${myRank}` : '—'}</b></div>
      </section>

      {account && me && <section className="panel">
        <div className="mine">
          {mine !== undefined && <div><span>本机总用量</span><b>{M(mine)}</b></div>}
          <div><span>已上报</span><b>{M(me.usage)}</b></div>
          <div><span>预计可得</span><b>{fmt(shareOf(me.usage))} <small>{s.symbol}</small></b></div>
        </div>
        <div className="actions">
          {!me.registered && phase === 0 && <button className="btn" disabled={busy} onClick={act('register')}>报名参加</button>}
          {me.registered && phase < 2 && <button className="btn ghost" disabled={scanning} onClick={scan}>{scanning ? '读取中…' : '读取本机用量'}</button>}
          {canReport && <button className="btn" disabled={busy} onClick={act('report', [BigInt(mine!)])}>上报</button>}
          {phase === 2 && !me.claimed && me.usage > 0n && <button className="btn" disabled={busy} onClick={act('claim', [account])}>领取 {fmt(shareOf(me.usage))} {s.symbol}</button>}
          {me.claimed && <span className="ok">已领取</span>}
        </div>
        {phase < 2 && <details className="more"><summary>下载采集器 · 读取本机用量</summary>
          <p className="sub">解压后运行 start.cmd，保持窗口打开，再回到这里点“读取本机用量”。</p>
          <div className="row"><a href="/downloads/blitz-ai-collector-windows.zip" download>下载</a>
            <label className="report-import">导入报告<input type="file" accept="application/json,.json" onChange={(e) => importReport(e.target.files?.[0])} /></label></div>
        </details>}
      </section>}
      {!account && phase === 0 && <button className="btn" onClick={() => connect().catch((e) => setMsg(errorMessage(e)))}>连接钱包并报名</button>}

      {msg && <p className="bad" role="alert">{msg}</p>}

      <section className="rank">
        <h2>{s.demo ? '演示排名 · 10 名模拟玩家' : '排名'}</h2>
        {s.demo && <p className="sub">模拟玩家使用随机 token 数；本榜占比按展示总量计算，不参与链上分币。你的奖池份额以上方链上数据为准。</p>}
        <input className="field" placeholder="输入钱包地址，查它的排名" value={lookup} onChange={(e) => setLookup(e.target.value.trim())} spellCheck={false} />
        {lookup && !isAddress(lookup) && <p className="bad">这不是有效的钱包地址（0x 开头，共 42 位）。</p>}
        {found && <p className="found">{found.registered
          ? <>{s.demo ? '链上排名' : '排名'} <b>#{found.rank}</b> · 已上报 {M(found.usage)} · 占比 {pct(found.usage).toFixed(2)}%</>
          : '这个钱包没有报名这个活动。'}</p>}
        {board.length === 0 ? <p className="mut">还没有人报名。</p> : (
          <ol className="board">
            {board.map((x, i) => {
              const you = !!account && x.wallet?.toLowerCase() === account.toLowerCase()
              return <li key={x.id} className={you ? 'you' : ''}>
                <span className="no">{i + 1}</span>
                <span className={x.simulated ? 'sub' : 'mono'} title={x.wallet}>{x.simulated ? x.label : short(x.wallet!)}{you && ' · 你'}</span>
                <span className="bar"><i style={{ width: `${boardPct(x.usage)}%` }} /></span>
                <span className="num">{M(x.usage)}</span>
                <span className="num pct">{boardPct(x.usage).toFixed(1)}%</span>
              </li>
            })}
          </ol>
        )}
        <p className="sub">创建者 <span className="mono" title={s.creator}>{short(s.creator)}</span> · 合约 <span className="mono" title={addr}>{short(addr)}</span></p>
      </section>
    </>
  )
}
