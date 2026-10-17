import { useCallback, useEffect, useState } from 'react'
import { formatEther, parseEther, isAddress, type Address, type Hex } from 'viem'
import type { Ctx } from './wallet'
import { errorMessage } from './messages'

const orderTypes = {
  Order: [
    { name: 'buyer', type: 'address' }, { name: 'seller', type: 'address' }, { name: 'paymentAsset', type: 'address' },
    { name: 'price', type: 'uint256' }, { name: 'nft', type: 'address' }, { name: 'tokenId', type: 'uint256' },
    { name: 'fundingDeadline', type: 'uint64' }, { name: 'deliveryDeadline', type: 'uint64' },
    { name: 'version', type: 'uint256' }, { name: 'nonce', type: 'uint256' },
  ],
}
const recoverTypes = {
  RecoverNFT: [
    { name: 'orderId', type: 'bytes32' }, { name: 'nft', type: 'address' }, { name: 'tokenId', type: 'uint256' },
    { name: 'receiver', type: 'address' }, { name: 'action', type: 'bytes32' }, { name: 'version', type: 'uint256' },
    { name: 'nonce', type: 'uint256' }, { name: 'expiry', type: 'uint256' },
  ],
}
const STAGES = ['未创建', '等待入金', '已完成', '已退款', '已取消']

type Bundle = { order: Record<string, string>; sigBuyer?: Hex; sigSeller?: Hex }
const toOrder = (o: Record<string, string>) => ({
  buyer: o.buyer as Address, seller: o.seller as Address, paymentAsset: o.paymentAsset as Address,
  price: BigInt(o.price), nft: o.nft as Address, tokenId: BigInt(o.tokenId),
  fundingDeadline: BigInt(o.fundingDeadline), deliveryDeadline: BigInt(o.deliveryDeadline),
  version: BigInt(o.version), nonce: BigInt(o.nonce),
})

export function TradePage({ ctx }: { ctx: Ctx }) {
  const { dep, account, pub, read, write, sign, log, chainId } = ctx
  const escrow = dep!.escrow as Address
  const domain = { name: 'MonadBlitzEscrow', version: '1', chainId, verifyingContract: escrow }

  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const act = (label: string, fn: () => Promise<void>) => async () => {
    setBusy(label); setErr('')
    try { await fn(); await refresh() } catch (e: any) { setErr(errorMessage(e)) } finally { setBusy('') }
  }

  // ---- test assets
  const [payBal, setPayBal] = useState(0n)
  const [claimable, setClaimable] = useState(0n)
  const [mintToken, setMintToken] = useState<string>()

  // ---- compose
  const [buyer, setBuyer] = useState('')
  const [seller, setSeller] = useState('')
  const [price, setPrice] = useState('100')
  const [tokenId, setTokenId] = useState('1')
  const [fundMin, setFundMin] = useState('10')
  const [delMin, setDelMin] = useState('5')
  const [bundleText, setBundleText] = useState('')

  // ---- order panel
  const [orderId, setOrderId] = useState('')
  const [st, setSt] = useState<any>()
  const [now, setNow] = useState(0)
  const [receiver, setReceiver] = useState('')

  const refresh = useCallback(async () => {
    try {
      setNow(Number((await pub.getBlock()).timestamp))
      if (account) {
        setPayBal(await read<bigint>(dep!.pay as Address, 'MockPayToken', 'balanceOf', [account]))
        setClaimable(await read<bigint>(escrow, 'Escrow', 'balances', [account, dep!.pay]))
      }
      if (/^0x[0-9a-fA-F]{64}$/.test(orderId)) setSt(await read<any>(escrow, 'Escrow', 'getOrder', [orderId]))
      else setSt(undefined)
    } catch (e: any) { setErr(errorMessage(e)) }
  }, [account, dep, escrow, orderId, pub, read])
  useEffect(() => { refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t) }, [refresh])

  const parseBundle = (): Bundle => JSON.parse(bundleText)

  const buildOrder = act('build', async () => {
    if (!isAddress(buyer) || !isAddress(seller)) throw new Error('请输入有效的买家和卖家地址。')
    const t = Number((await pub.getBlock()).timestamp)
    const f = t + Number(fundMin) * 60
    const order = {
      buyer, seller, paymentAsset: dep!.pay, price: parseEther(price).toString(), nft: dep!.nft, tokenId: tokenId,
      fundingDeadline: String(f), deliveryDeadline: String(f + Number(delMin) * 60), version: '1',
      nonce: String(Math.floor(Math.random() * 1e9)),
    }
    setBundleText(JSON.stringify({ order } satisfies Bundle, null, 2))
  })

  const signBundle = act('sign', async () => {
    const b = parseBundle()
    const o = toOrder(b.order)
    const me = account?.toLowerCase()
    if (me !== o.buyer.toLowerCase() && me !== o.seller.toLowerCase()) throw new Error('当前钱包不是此订单的买家或卖家。')
    const sig = await sign({ domain, types: orderTypes, primaryType: 'Order', message: o })
    if (me === o.buyer.toLowerCase()) b.sigBuyer = sig
    else b.sigSeller = sig
    setBundleText(JSON.stringify(b, null, 2))
    log(`已以${me === o.buyer.toLowerCase() ? '买家' : '卖家'}身份签署订单，请将订单 JSON 发给交易对方`)
  })

  const createOrder = act('create', async () => {
    const b = parseBundle()
    if (!b.sigBuyer || !b.sigSeller) throw new Error('需要买卖双方签名后才能创建订单。')
    const o = toOrder(b.order)
    await write(escrow, 'Escrow', 'createOrder', [o, b.sigBuyer, b.sigSeller])
    const id = await read<Hex>(escrow, 'Escrow', 'hashOrder', [o])
    setOrderId(id)
  })

  const cancelAuth = act('cancelAuth', async () => {
    await write(escrow, 'Escrow', 'cancelAuthorization', [toOrder(parseBundle().order)])
  })

  const sellerAuth = act('auth', async () => {
    if (!st) throw new Error('请先加载订单。')
    if (!isAddress(receiver)) throw new Error('请输入有效的接收地址。')
    const expiry = BigInt((await pub.getBlock()).timestamp) + 3600n
    const nonce = BigInt(Math.floor(Math.random() * 1e9))
    const action = await read<Hex>(escrow, 'Escrow', 'RECOVER_ACTION')
    const message = { orderId, nft: st.terms.nft, tokenId: st.terms.tokenId, receiver, action, version: 1n, nonce, expiry }
    const sig = await sign({ domain, types: recoverTypes, primaryType: 'RecoverNFT', message })
    setBundleText(JSON.stringify({ recovery: { orderId, receiver, nonce: nonce.toString(), expiry: expiry.toString(), sig } }, null, 2))
  })
  const execAuth = act('execAuth', async () => {
    const r = JSON.parse(bundleText).recovery
    await write(escrow, 'Escrow', 'recoverNFTWithAuth', [r.orderId, r.receiver, BigInt(r.nonce), BigInt(r.expiry), r.sig])
  })

  const me = account?.toLowerCase()
  const t = st?.terms
  const isBuyer = !!t && me === t.buyer.toLowerCase()
  const isSeller = !!t && me === t.seller.toLowerCase()
  const stage: number = st ? Number(st.stage) : 0
  const awaiting = stage === 1
  const full = !!st && st.buyerFunded && st.sellerFunded
  const F = t ? Number(t.fundingDeadline) : 0
  const D = t ? Number(t.deliveryDeadline) : 0
  const e = (v: bigint) => formatEther(v)

  return (
    <>
      <div className="card">
        <h2>1 · 测试资产（仅供演示）</h2>
        <p className="sub">我的 MPAY：<b>{e(payBal)}</b> · 可提取托管余额：<b>{e(claimable)}</b></p>
        <div className="row">
          <button className="sec" disabled={!!busy || !account} onClick={act('mintPay', () => write(dep!.pay as Address, 'MockPayToken', 'mint', [account!, parseEther('1000')]))}>领取 1000 MPAY 测试币</button>
          <button className="sec" disabled={!!busy || !account} onClick={act('approvePay', () => write(dep!.pay as Address, 'MockPayToken', 'approve', [escrow, 2n ** 256n - 1n]))}>授权托管合约使用 MPAY</button>
          <button className="sec" disabled={!!busy || !account} onClick={act('mintNft', async () => {
            const next = await read<bigint>(dep!.nft as Address, 'MockNFT', 'nextId')
            await write(dep!.nft as Address, 'MockNFT', 'mint', [account!]); setMintToken(String(next)); setTokenId(String(next))
          })}>铸造测试 NFT</button>
          <button className="sec" disabled={!!busy || !account} onClick={act('approveNft', () => write(dep!.nft as Address, 'MockNFT', 'setApprovalForAll', [escrow, true]))}>授权托管合约使用 NFT</button>
          <button disabled={!!busy || claimable === 0n} onClick={act('withdraw', () => write(escrow, 'Escrow', 'withdraw', [dep!.pay]))}>提取 {e(claimable)} MPAY</button>
        </div>
        {mintToken && <p className="ok">已铸造 NFT #{mintToken}</p>}
      </div>

      <div className="card">
        <h2>2 · 创建并签署订单</h2>
        <p className="sub">买卖双方各存入价格 P。成交后，NFT 交付买家，卖家可提取 2P。无保护期，无人工仲裁。</p>
        <div className="row">
          <input placeholder="买家地址 0x…" value={buyer} onChange={(x) => setBuyer(x.target.value)} size={44} />
          <input placeholder="卖家地址 0x…" value={seller} onChange={(x) => setSeller(x.target.value)} size={44} />
        </div>
        <div className="row">
          <label>价格 P <input value={price} onChange={(x) => setPrice(x.target.value)} size={6} /> MPAY</label>
          <label>NFT 编号 <input value={tokenId} onChange={(x) => setTokenId(x.target.value)} size={4} /></label>
          <label>入金时限 <input value={fundMin} onChange={(x) => setFundMin(x.target.value)} size={3} /> 分钟</label>
          <label>入金截止后交付时限 <input value={delMin} onChange={(x) => setDelMin(x.target.value)} size={3} /> 分钟</label>
        </div>
        <div className="row">
          {account && <button className="sec" onClick={() => setBuyer(account)}>我是买家</button>}
          {account && <button className="sec" onClick={() => setSeller(account)}>我是卖家</button>}
          <button disabled={!!busy} onClick={buildOrder}>生成订单</button>
        </div>
        <textarea value={bundleText} onChange={(x) => setBundleText(x.target.value)} placeholder="订单数据 JSON（可在此粘贴交易对方发来的订单或取回授权）" />
        <div className="row">
          <button disabled={!!busy || !account || !bundleText} onClick={signBundle}>使用当前钱包签名</button>
          <button disabled={!!busy || !account || !bundleText} onClick={createOrder}>在链上创建（需双方签名）</button>
          <button className="sec" disabled={!!busy || !account || !bundleText} onClick={cancelAuth}>取消此订单授权</button>
        </div>
      </div>

      <div className="card">
        <h2>3 · 订单详情</h2>
        <div className="row">
          <input className="mono" placeholder="订单编号 0x…" value={orderId} onChange={(x) => setOrderId(x.target.value.trim())} size={70} />
        </div>
        {!st || stage === 0 ? <p className="mut">请输入订单编号。</p> : (
          <>
            <div className="grid">
              <div className="stat">订单状态<b>{STAGES[stage]}{awaiting && full ? ' · 已全部入金' : ''}</b></div>
              <div className="stat">价格 P<b>{e(t.price)} MPAY</b></div>
              <div className="stat">NFT<b>#{String(t.tokenId)}</b></div>
              <div className="stat">买家已入金<b className={st.buyerFunded ? 'ok' : ''}>{st.buyerFunded ? '是' : '否'}</b></div>
              <div className="stat">卖家已入金并托管 NFT<b className={st.sellerFunded ? 'ok' : ''}>{st.sellerFunded ? '是' : '否'}</b></div>
              <div className="stat">入金截止时间<b>{F - now > 0 ? `剩余 ${F - now} 秒` : '已截止'}</b></div>
              <div className="stat">交付截止时间<b>{D - now > 0 ? `剩余 ${D - now} 秒` : '已截止'}</b></div>
              <div className="stat">NFT 取回<b>{st.nftReturnPending ? '待取回' : '—'}</b></div>
            </div>
            <div className="row">
              <button disabled={!!busy || !awaiting || !isBuyer || st.buyerFunded || now >= F} onClick={act('fundBuyer', () => write(escrow, 'Escrow', 'fundBuyer', [orderId]))}>买家入金</button>
              <button disabled={!!busy || !awaiting || !isSeller || st.sellerFunded || now >= F} onClick={act('fundSeller', () => write(escrow, 'Escrow', 'fundSeller', [orderId]))}>卖家入金并托管 NFT</button>
              <button disabled={!!busy || !awaiting || !full || now >= D} onClick={act('complete', () => write(escrow, 'Escrow', 'complete', [orderId]))}>完成交付</button>
              <button className="sec" disabled={!!busy || !awaiting || full || now < F} onClick={act('fExit', () => write(escrow, 'Escrow', 'fundingTimeoutExit', [orderId]))}>入金超时退款</button>
              <button className="sec" disabled={!!busy || !awaiting || !full || now < D} onClick={act('dExit', () => write(escrow, 'Escrow', 'deliveryTimeoutExit', [orderId]))}>交付超时退款</button>
              <button className="sec" disabled={!!busy || !awaiting || st.buyerFunded || st.sellerFunded || (!isBuyer && !isSeller)} onClick={act('cancel', () => write(escrow, 'Escrow', 'cancelUnfunded', [orderId]))}>取消未入金订单</button>
            </div>
            {st.nftReturnPending && (
              <>
                <h2 style={{ marginTop: 12 }}>取回 NFT（与资金退款独立）</h2>
                <div className="row">
                  <input placeholder="接收地址 0x…" value={receiver} onChange={(x) => setReceiver(x.target.value)} size={44} />
                  {account && <button className="sec" onClick={() => setReceiver(account)}>使用我的地址</button>}
                  <button disabled={!!busy || !isSeller} onClick={act('recover', () => write(escrow, 'Escrow', 'recoverNFT', [orderId, receiver]))}>原卖家取回 NFT</button>
                  <button className="sec" disabled={!!busy || !isSeller} onClick={sellerAuth}>签署他人代取授权</button>
                  <button className="sec" disabled={!!busy} onClick={execAuth}>执行已粘贴的取回授权</button>
                </div>
              </>
            )}
          </>
        )}
        {err && <p className="bad" role="alert">{err}</p>}
      </div>
    </>
  )
}
