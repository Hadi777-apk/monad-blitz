import { useState } from 'react'
import { useWallet } from './wallet'
import { MinerPage } from './MinerPage'
import { TradePage } from './TradePage'

export function App() {
  const ctx = useWallet()
  const [tab, setTab] = useState<'mine' | 'trade'>('mine')
  const wrong = ctx.account && ctx.walletChainId !== ctx.chainId

  return (
    <main>
      <h1>Blitz Mine · 千枚矿场</h1>
      <p className="sub">
        v0.5 hackathon baseline · testnet assets only · unaudited, not load-tested. Chain {ctx.chainId}
        {ctx.dep ? '' : ' — no deployment configured for this chain (run the deploy + export scripts)'}
      </p>
      <div className="row">
        {ctx.account ? (
          <span className="mono">{ctx.account}</span>
        ) : (
          <button onClick={() => ctx.connect().catch((e) => ctx.log(String(e.message)))}>Connect wallet</button>
        )}
        {wrong && <span className="bad">Wallet is on chain {ctx.walletChainId}; switch to {ctx.chainId}.</span>}
      </div>
      <div className="tabs">
        <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>Mine</button>
        <button className={tab === 'trade' ? 'on' : ''} onClick={() => setTab('trade')}>Trade (NFT escrow)</button>
      </div>
      {ctx.dep && (tab === 'mine' ? <MinerPage ctx={ctx} /> : <TradePage ctx={ctx} />)}
      <div className="card">
        <h2>Activity</h2>
        <div className="log">{ctx.logs.join('\n') || 'No activity yet.'}</div>
      </div>
    </main>
  )
}
