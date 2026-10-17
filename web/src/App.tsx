import { useEffect, useState } from 'react'
import { isAddress, type Address } from 'viem'
import { isArchivedCampaign, short, switchAccount, useAccount } from './lib'
import { errorMessage } from './messages'
import { Campaign } from './Campaign'
import { Home } from './Home'
import { WalletHelp } from './WalletHelp'

export function App() {
  const w = useAccount()
  const [err, setErr] = useState('')
  const c = new URLSearchParams(location.search).get('c')
  const archived = !!c && isArchivedCampaign(c)
  const campaign = c && isAddress(c) && !archived ? (c as Address) : undefined
  useEffect(() => {
    if (archived) location.replace(location.pathname)
  }, [archived])
  const connect = async () => {
    if (!w.hasWallet) { setErr('这个浏览器还没有钱包扩展，请先按上面的步骤安装。'); return }
    setErr('')
    await w.connect().catch((e) => { setErr(errorMessage(e)); throw e })
  }

  return (
    <main>
      <div className="hub">
        <header className="top">
          <h1><a href={location.pathname}>千枚矿场</a></h1>
          {w.account ? <button className="pill mono" title={`${w.account}\n点击切换钱包`} onClick={() => switchAccount().catch((e) => setErr(errorMessage(e)))}>{short(w.account)} · 切换</button>
            : w.hasWallet && <button className="btn sm" onClick={() => connect().catch(() => {})}>连接钱包</button>}
        </header>
        {err && <p className="bad" role="alert">{err}</p>}
        {!w.hasWallet && <WalletHelp />}
        {campaign ? <Campaign addr={campaign} account={w.account} connect={connect} /> : <Home account={w.account} connect={connect} />}
      </div>
    </main>
  )
}
