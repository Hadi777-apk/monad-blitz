import { useCallback, useEffect, useState } from 'react'
import { formatUnits, isAddress, parseEventLogs, parseUnits, type Address } from 'viem'
import { campaignAbi, cfg, erc20Abi, factoryAbi, faucetAbi, hms, isArchivedCampaign, phaseOf, PHASES, pub, sendTx, short, useTick, wmonAbi } from './lib'
import { errorMessage } from './messages'

type Item = { addr: Address; registerEnd: number; reportEnd: number; claimEnd: number; pool: bigint; symbol: string; decimals: number; count: number; now: number; demo: boolean }

const fmt = (n: bigint, d: number) => Number(formatUnits(n, d)).toLocaleString('zh-CN', { maximumFractionDigits: 4 })

export function Home({ account, connect }: { account?: Address; connect: () => Promise<void> }) {
  const [items, setItems] = useState<Item[]>()
  const [msg, setMsg] = useState(''), [busy, setBusy] = useState(false)
  const [token, setToken] = useState(cfg.wmon ?? cfg.faucet ?? ''), [pool, setPool] = useState('50')
  const [monBal, setMonBal] = useState<bigint>()
  const [regH, setRegH] = useState('24'), [repH, setRepH] = useState('1'), [claimH, setClaimH] = useState('168')
  const [faucetBal, setFaucetBal] = useState<bigint>()
  const tick = useTick()

  const load = useCallback(async () => {
    const p = pub()
    const addrs: Address[] = []
    if (cfg.address && !isArchivedCampaign(cfg.address)) addrs.push(cfg.address as Address)
    if (cfg.factory) {
      const list = await p.readContract({ address: cfg.factory as Address, abi: factoryAbi, functionName: 'latest', args: [0n, 30n] }) as Address[]
      for (const a of list) if (!isArchivedCampaign(a) && !addrs.some((x) => x.toLowerCase() === a.toLowerCase())) addrs.push(a)
    }
    const now = Number((await p.getBlock()).timestamp)
    const rd = (address: Address, abi: any, functionName: string, args: unknown[] = []) => p.readContract({ address, abi, functionName, args } as any) as Promise<any>
    const out = await Promise.all(addrs.map(async (addr): Promise<Item> => {
      const [registerEnd, reportEnd, claimEnd, finalized, count, token] = await Promise.all(
        ['registerEnd', 'reportEnd', 'claimEnd', 'finalized', 'participantCount', 'token'].map((f) => rd(addr, campaignAbi, f)))
      const [pool, symbol, decimals] = await Promise.all([
        finalized ? rd(addr, campaignAbi, 'pool') : rd(token, erc20Abi, 'balanceOf', [addr]),
        rd(token, erc20Abi, 'symbol'), rd(token, erc20Abi, 'decimals'),
      ])
      const demo = cfg.factory ? await rd(cfg.factory as Address, factoryAbi, 'isDemo', [addr]) as boolean : false
      return { addr, registerEnd: Number(registerEnd), reportEnd: Number(reportEnd), claimEnd: Number(claimEnd), pool, symbol, decimals: Number(decimals), count: Number(count), now, demo }
    }))
    setItems(out)
    if (account) setMonBal(await p.getBalance({ address: account }))
    if (account && cfg.faucet) setFaucetBal(await rd(cfg.faucet as Address, erc20Abi, 'balanceOf', [account]))
  }, [account])

  useEffect(() => {
    load().catch((e) => setMsg(errorMessage(e)))
    const t = setInterval(() => load().catch(() => {}), 15000)
    return () => clearInterval(t)
  }, [load])

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true); setMsg('')
    try { await fn(); await load() } catch (e) { setMsg(errorMessage(e)) } finally { setBusy(false) }
  }

  const drip = run(async () => {
    if (!account || !cfg.faucet) throw new Error('请先连接钱包。')
    const p = pub()
    const last = Number(await p.readContract({ address: cfg.faucet as Address, abi: faucetAbi, functionName: 'lastDrip', args: [account] }))
    const now = Number((await p.getBlock()).timestamp)
    if (last && now < last + 3600) throw new Error(`测试币每小时可领一次，${hms(last + 3600 - now)}后再来。`)
    await sendTx(account, cfg.faucet as Address, faucetAbi, 'faucet')
  })

  const create = run(async () => {
    if (!account) throw new Error('请先连接钱包。')
    if (!cfg.factory) throw new Error('还没有部署创建活动的合约。')
    if (!isAddress(token)) throw new Error('奖励代币地址无效（0x 开头，共 42 位）。')
    const p = pub()
    const rd = (address: Address, functionName: string, args: unknown[] = []) => p.readContract({ address, abi: erc20Abi, functionName, args } as any) as Promise<any>
    const [dec, sym, bal] = await Promise.all([rd(token, 'decimals'), rd(token, 'symbol'), rd(token, 'balanceOf', [account])])
    let amount: bigint
    try { amount = parseUnits(pool, Number(dec)) } catch { throw new Error('奖池数量不是有效数字。') }
    if (amount <= 0n) throw new Error('奖池必须大于 0。')
    if (bal < amount) {
      if (!cfg.wmon || token.toLowerCase() !== cfg.wmon.toLowerCase()) throw new Error(`钱包里的 ${sym} 不够：有 ${fmt(bal, Number(dec))}，需要 ${pool}。`)
      // Wrap the shortfall: native MON -> WMON, keeping 0.5 MON for gas.
      const need = amount - bal
      const mon = await p.getBalance({ address: account })
      if (mon < need + parseUnits('0.5', 18)) throw new Error(`MON 不够：奖池要 ${pool}，另外还要留 0.5 MON 付手续费。当前钱包 ${short(account)} 里只有 ${fmt(mon, 18)}，可点右上角“切换”换钱包。`)
      await sendTx(account, token, wmonAbi, 'deposit', [], need)
    }
    const hrs = [regH, repH, claimH].map(Number)
    if (hrs.some((h) => !(h >= 0.1))) throw new Error('三个时间都至少要 0.1 小时。')
    const t0 = Number((await p.getBlock()).timestamp)
    const registerEnd = t0 + Math.round(hrs[0] * 3600), reportEnd = registerEnd + Math.round(hrs[1] * 3600), claimEnd = reportEnd + Math.round(hrs[2] * 3600)
    const allowance = await rd(token, 'allowance', [account, cfg.factory])
    if (allowance < amount) await sendTx(account, token, erc20Abi, 'approve', [cfg.factory, amount])
    const receipt = await sendTx(account, cfg.factory as Address, factoryAbi, 'createDemo', [token, amount, registerEnd, reportEnd, claimEnd])
    const ev = parseEventLogs({ abi: factoryAbi, logs: receipt.logs, eventName: 'CampaignCreated' })[0]
    location.href = `?c=${ev.args.campaign}`
  })

  return (
    <>
      <section className="lead">
        <h2>活动</h2>
        {!items ? <p className="mut">{msg || '加载中…'}</p> : items.length === 0 ? <p className="mut">还没有活动，在下面创建第一个。</p> : (
          <ul className="camps">
            {items.map((c) => {
              const now = c.now + tick, ph = phaseOf(now, c)
              const left = ph < 3 ? [c.registerEnd, c.reportEnd, c.claimEnd][ph] - now : 0
              return <li key={c.addr}><a href={`?c=${c.addr}`}>
                <span className="pool">{fmt(c.pool, c.decimals)}<small>{c.symbol}</small></span>
                <span className="meta">{c.count} 人报名{ph < 3 && ` · 剩余 ${hms(left)}`}</span>
                <span className={`tag t${ph}`}>{PHASES[ph]}</span>
              </a></li>
            })}
          </ul>
        )}
      </section>

      {msg && items && <p className="bad" role="alert">{msg}</p>}

      <section className="panel">
        <h2>创建活动</h2>
        {!cfg.factory ? <p className="mut">创建功能还没有开通。</p> : !account ? (
          <button className="btn" onClick={() => connect().catch((e) => setMsg(errorMessage(e)))}>连接钱包后创建</button>
        ) : (
          <>
            <label className="fld"><span>奖励代币地址</span>
              <input className="field mono" value={token} onChange={(e) => setToken(e.target.value.trim())} spellCheck={false} placeholder="0x…" /></label>
            <div className="row">
              {cfg.wmon && <button className="linkbtn" onClick={() => setToken(cfg.wmon!)}>用 MON</button>}
              {cfg.faucet && <button className="linkbtn" onClick={() => setToken(cfg.faucet!)}>用测试币</button>}
              <button className="linkbtn" onClick={() => { setPool('1'); setRegH('1'); setRepH('1'); setClaimH('1') }}>快速预设</button>
              <span className="mut">钱包 MON：{monBal === undefined ? '…' : fmt(monBal, 18)}</span>
            </div>
            {cfg.wmon && token.toLowerCase() === cfg.wmon.toLowerCase() && <p className="sub">用 MON 当奖池：不够的部分会在创建时自动换成 WMON（1:1，可随时换回），并留 0.5 MON 付手续费。</p>}
            {cfg.faucet && token.toLowerCase() === cfg.faucet.toLowerCase() && <div className="row">
              <span className="mut">测试币 TBLITZ：{faucetBal === undefined ? '…' : fmt(faucetBal, 18)}</span>
              <button className="btn ghost sm" disabled={busy} onClick={drip}>领 1000 测试币</button>
            </div>}
            <label className="fld"><span>奖池数量</span>
              <input className="field" inputMode="decimal" value={pool} onChange={(e) => setPool(e.target.value)} /></label>
            <div className="trio">
              <label className="fld"><span>报名（小时）</span><input className="field" inputMode="decimal" value={regH} onChange={(e) => setRegH(e.target.value)} /></label>
              <label className="fld"><span>上报（小时）</span><input className="field" inputMode="decimal" value={repH} onChange={(e) => setRepH(e.target.value)} /></label>
              <label className="fld"><span>领取（小时）</span><input className="field" inputMode="decimal" value={claimH} onChange={(e) => setClaimH(e.target.value)} /></label>
            </div>
            <p className="sub">奖池会从你的钱包转进活动，之后谁也拿不回，只能按用量分掉。领取期结束后没领完的退回你的钱包。创建者可以随时提前结束当前阶段（活动页左下角“跳过”）。</p>
            <p className="sub">新活动的排行榜将预置 10 名模拟玩家，随机用量仅用于展示，不参与链上分币；仍可跳过时间。</p>
            <div className="actions"><button className="btn" disabled={busy} onClick={create}>{busy ? '处理中…' : '创建活动'}</button></div>
          </>
        )}
      </section>
    </>
  )
}
