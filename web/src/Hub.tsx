import { useCallback, useEffect, useState } from 'react'
import { formatUnits, parseAbi, type Address } from 'viem'
import { chains, publicClientFor, walletClientFor } from './chain'
import { errorMessage } from './messages'
import { validateSummary, updateBaseline, type UsageSummary, type UsageBaseline } from './usage-summary'
import hub from './hub.json'

const abi = parseAbi([
  'function registerEnd() view returns(uint64)', 'function reportEnd() view returns(uint64)', 'function claimEnd() view returns(uint64)',
  'function token() view returns(address)', 'function pool() view returns(uint256)', 'function finalized() view returns(bool)',
  'function totalUsage() view returns(uint256)', 'function registered(address) view returns(bool)', 'function claimed(address) view returns(bool)',
  'function usage(address) view returns(uint256)', 'function participantCount() view returns(uint256)',
  'function participants(uint256 offset,uint256 limit) view returns(address[])',
  'function register()', 'function report(uint256 cumulative)', 'function claim(address wallet) returns(uint256)',
])
const erc20 = parseAbi(['function balanceOf(address) view returns(uint256)', 'function symbol() view returns(string)', 'function decimals() view returns(uint8)'])
const chainId = hub.chainId
const contract = hub.address as Address
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
type State = { now: number; registerEnd: number; reportEnd: number; claimEnd: number; pool: bigint; total: bigint; count: number; symbol: string; decimals: number;
  me?: { registered: boolean; usage: bigint; claimed: boolean }; rows: { wallet: Address; usage: bigint }[] }

async function ensureChain() {
  const eth = window.ethereum
  if (!eth) throw new Error('未检测到钱包扩展。')
  const hex = '0x' + chainId.toString(16)
  try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] }) } catch (e: any) {
    if (Number(e.code) !== 4902) throw e
    const c = chains[chainId as keyof typeof chains]
    await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hex, chainName: c.name, nativeCurrency: c.nativeCurrency, rpcUrls: c.rpcUrls.default.http }] })
  }
}

export function Hub() {
  const [account, setAccount] = useState<Address>()
  const [s, setS] = useState<State>()
  const [busy, setBusy] = useState(false), [scanning, setScanning] = useState(false), [msg, setMsg] = useState(''), [tick, setTick] = useState(0)
  const [summary, setSummary] = useState<UsageSummary>(), [mine, setMine] = useState<number>(), [usageNotice, setUsageNotice] = useState('')
  useEffect(() => {
    window.ethereum?.request({ method: 'eth_accounts' }).then((a: string[]) => setAccount(a[0] as Address)).catch(() => {})
  }, [])
  const refresh = useCallback(async () => {
    if (!contract) return
    const pub = publicClientFor(chainId)
    const r = (functionName: string, args: unknown[] = []) => pub.readContract({ address: contract, abi, functionName, args } as any) as Promise<any>
    const [reg, rep, claim, finalized, total, count, block, token] = await Promise.all([r('registerEnd'), r('reportEnd'), r('claimEnd'), r('finalized'), r('totalUsage'), r('participantCount'), pub.getBlock(), r('token')])
    const [pool, symbol, decimals] = await Promise.all([finalized ? r('pool') : pub.readContract({ address: token, abi: erc20, functionName: 'balanceOf', args: [contract] }), pub.readContract({ address: token, abi: erc20, functionName: 'symbol' }), pub.readContract({ address: token, abi: erc20, functionName: 'decimals' })])
    const wallets: Address[] = count > 0n ? await r('participants', [0n, 50n]) : []
    const rows = await Promise.all(wallets.map(async wallet => ({ wallet, usage: await r('usage', [wallet]) as bigint })))
    const me = account ? { registered: await r('registered', [account]), usage: await r('usage', [account]) as bigint, claimed: await r('claimed', [account]) } : undefined
    setS({ now: Number(block.timestamp), registerEnd: Number(reg), reportEnd: Number(rep), claimEnd: Number(claim), pool: pool as bigint, total, count: Number(count), symbol: symbol as string, decimals: Number(decimals), me, rows }); setTick(0)
  }, [account])
  useEffect(() => { refresh().catch(e => setMsg(errorMessage(e))); const t = setInterval(() => refresh().catch(() => {}), 8000); return () => clearInterval(t) }, [refresh])
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 1000); return () => clearInterval(t) }, [])
  const run = (fn: () => Promise<void>) => async () => { setBusy(true); setMsg(''); try { await fn(); await refresh() } catch (e) { setMsg(errorMessage(e)) } finally { setBusy(false) } }
  const connect = run(async () => { await ensureChain(); const [a] = await window.ethereum!.request({ method: 'eth_requestAccounts' }); setAccount(a) })
  const send = (functionName: 'register' | 'report' | 'claim', args: unknown[] = []) => run(async () => {
    if (!account) throw new Error('请先连接钱包。')
    await ensureChain()
    const actual: string[] = await window.ethereum!.request({ method: 'eth_accounts' })
    if (actual[0]?.toLowerCase() !== account.toLowerCase()) { setAccount(actual[0] as Address); throw new Error('钱包账户已切换，请核对新账户后重试。') }
    const hash = await walletClientFor(chainId, account).writeContract({ address: contract, abi, functionName, args, account, chain: chains[chainId as keyof typeof chains] } as any)
    const receipt = await publicClientFor(chainId).waitForTransactionReceipt({ hash }); if (receipt.status !== 'success') throw new Error('交易执行失败，请检查活动阶段。')
  })
  const acceptSummary = (value: unknown) => {
    if (!account) throw new Error('请先连接钱包，再建立本机统计起点。')
    const next = validateSummary(value)
    const key = `hub-usage-v2:${chainId}:${contract.toLowerCase()}:${account.toLowerCase()}:${next.machineId}`
    let previous: UsageBaseline | undefined
    try { const raw = localStorage.getItem(key); if (raw) previous = JSON.parse(raw) } catch { throw new Error('无法读取已保存的本机起点，请检查浏览器存储。') }
    const result = updateBaseline(next, previous)
    try { localStorage.setItem(key, JSON.stringify(result.next)) } catch { throw new Error('无法保存本机起点，未启用上报。请检查浏览器存储。') }
    setSummary(next); setMine(result.earned)
    setUsageNotice(result.rollback.length ? `${result.rollback.join('、')} 的累计数回退，已暂停这些来源的新增计数。` : result.first ? '已建立本机起点，历史用量不计入本次活动。之后再次读取会累计新增用量。' : '已更新本机新增用量，重复读取不会重复计数。')
  }
  const scan = async () => {
    setScanning(true); setMsg('')
    try {
      const response = await fetch('http://127.0.0.1:8788/summary', { cache: 'no-store', signal: AbortSignal.timeout(125000) })
      if (!response.ok) throw new Error('本机统计服务暂不可用，请打开采集器后重试。')
      acceptSummary(await response.json())
    } catch (e: any) { setMsg(e instanceof TypeError ? '无法连接本机采集器：请先运行下载包里的 start.cmd，或下载统计报告后导入。' : errorMessage(e)) } finally { setScanning(false) }
  }
  const importReport = async (file?: File) => {
    if (!file) return
    setMsg('')
    try { if (file.size > 2e6) throw new Error('请导入采集器生成的小型统计报告，不要选择聊天原始日志。'); acceptSummary(JSON.parse(await file.text())) } catch (e) { setMsg(errorMessage(e)) }
  }
  if (!contract) return <p className="mut">尚未部署活动。</p>
  if (!s) return <p className="mut">{msg || '加载中…'}</p>
  const now = s.now + tick, phase = now < s.registerEnd ? 0 : now < s.reportEnd ? 1 : now < s.claimEnd ? 2 : 3
  const until = [s.registerEnd, s.reportEnd, s.claimEnd][phase] - now
  const left = phase < 3 ? `${Math.floor(until / 3600)}时${Math.floor(until / 60) % 60}分${until % 60}秒` : ''
  const fmt = (n: bigint) => Number(formatUnits(n, s.decimals)).toLocaleString('zh-CN', { maximumFractionDigits: 6 })
  const share = s.me && s.total > 0n ? s.pool * s.me.usage / s.total : 0n
  const steps = ['报名', '上报', '领取']
  const myPct = s.me && s.total > 0n ? Number(s.me.usage * 10000n / s.total) / 100 : 0
  const canReport = phase === 1 && !!s.me?.registered && mine !== undefined && BigInt(mine) > (s.me?.usage ?? 0n)
  return <div className="hub">
    <header className="top">
      <h1>千枚矿场</h1>
      {account ? <span className="pill mono" title={account}>{short(account)}</span> : <button className="btn sm" disabled={busy} onClick={connect}>连接钱包</button>}
    </header>

    <section className="hero">
      <div className="label">奖池</div>
      <div className="big">{fmt(s.pool)}<span>{s.symbol}</span></div>
      <ol className="steps">{steps.map((n, i) => <li key={n} className={i < phase ? 'done' : i === phase ? 'on' : ''}>{n}</li>)}</ol>
      <div className="when">{phase < 3 ? <>{steps[phase]}中 · 剩余 <b>{left}</b></> : '活动已结束'}</div>
    </section>

    <section className="stats">
      <div><span>已报名</span><b>{s.count.toLocaleString('zh-CN')}</b></div>
      <div><span>总用量</span><b>{s.total.toLocaleString('zh-CN')}</b></div>
      <div><span>我的占比</span><b>{s.me?.registered ? `${myPct.toFixed(2)}%` : '—'}</b></div>
    </section>

    {account && s.me && <section className="panel">
      <div className="mine">
        <div><span>已上报</span><b>{s.me.usage.toLocaleString('zh-CN')}</b></div>
        <div><span>预计可得</span><b>{fmt(share)} <small>{s.symbol}</small></b></div>
        {mine !== undefined && <div><span>本次新增</span><b>{mine.toLocaleString('zh-CN')}</b></div>}
      </div>
      <div className="actions">
        {!s.me.registered && (phase === 0 ? <button className="btn" disabled={busy} onClick={send('register')}>报名参加</button> : <span className="mut">未报名</span>)}
        {s.me.registered && phase < 2 && <button className="btn ghost" disabled={scanning} onClick={scan}>{scanning ? '读取中…' : '读取本机用量'}</button>}
        {canReport && <button className="btn" disabled={busy} onClick={send('report', [BigInt(mine!)])}>上报</button>}
        {phase === 2 && !s.me.claimed && s.me.usage > 0n && <button className="btn" disabled={busy} onClick={send('claim', [account])}>领取 {fmt(share)} {s.symbol}</button>}
        {s.me.claimed && <span className="ok">已领取</span>}
      </div>
      {usageNotice.includes('回退') && <p className="bad" role="status">{usageNotice}</p>}
      {s.me.registered && phase < 2 && <details className="more"><summary>采集器</summary>
        <div className="row"><a href="/downloads/blitz-ai-collector-windows.zip" download>下载</a>
          <label className="report-import">导入报告<input type="file" accept="application/json,.json" onChange={e => importReport(e.target.files?.[0])} /></label></div>
      </details>}
    </section>}

    {msg && <p className="bad" role="alert">{msg}</p>}

    {s.rows.length > 0 && <details className="more list"><summary>参与钱包 · {s.count.toLocaleString('zh-CN')}</summary>
      <ul>{s.rows.map(x => { const p = s.total > 0n ? Number(x.usage * 10000n / s.total) / 100 : 0; return <li key={x.wallet}>
        <span className="mono" title={x.wallet}>{short(x.wallet)}</span>
        <span className="bar"><i style={{ width: `${p}%` }} /></span>
        <span className="num">{p.toFixed(1)}%</span>
      </li> })}</ul>
    </details>}
  </div>
}
