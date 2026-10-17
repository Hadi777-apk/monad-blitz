/** Shown when the browser has no wallet extension. The private key stays in the user's own wallet. */
export function WalletHelp() {
  return (
    <section className="panel help">
      <h2>还没有钱包？</h2>
      <ol>
        <li>在电脑浏览器安装钱包扩展：<a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">MetaMask</a> 或 <a href="https://www.okx.com/web3" target="_blank" rel="noopener noreferrer">OKX 钱包</a>。</li>
        <li>在扩展里“创建钱包”，把助记词抄在纸上自己保管，<b>不要发给任何人，包括本站</b>。</li>
        <li>回到本页刷新，点“连接钱包”，会自动添加 Monad 测试网。</li>
        <li>到<a href="https://faucet.monad.xyz" target="_blank" rel="noopener noreferrer">水龙头</a>领一点测试币 MON，用来付手续费。</li>
      </ol>
      <p className="sub">钱包地址就是扩展里显示的那串 0x…，连接后自动带入，不用手填。</p>
    </section>
  )
}
