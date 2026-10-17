import { useCallback, useEffect, useState } from 'react'
import { formatEther, parseEther, isAddress, type Address, type Hex } from 'viem'
import type { Ctx } from './wallet'

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
const STAGES = ['None', 'Awaiting funding', 'Completed', 'Refunded', 'Cancelled']

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
    try { await fn(); await refresh() } catch (e: any) { setErr(e.message) } finally { setBusy('') }
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
    } catch (e: any) { setErr(e.shortMessage ?? e.message) }
  }, [account, dep, escrow, orderId, pub, read])
  useEffect(() => { refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t) }, [refresh])

  const parseBundle = (): Bundle => JSON.parse(bundleText)

  const buildOrder = act('build', async () => {
    if (!isAddress(buyer) || !isAddress(seller)) throw new Error('Enter valid buyer and seller addresses')
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
    if (me !== o.buyer.toLowerCase() && me !== o.seller.toLowerCase()) throw new Error('Connected wallet is neither buyer nor seller')
    const sig = await sign({ domain, types: orderTypes, primaryType: 'Order', message: o })
    if (me === o.buyer.toLowerCase()) b.sigBuyer = sig
    else b.sigSeller = sig
    setBundleText(JSON.stringify(b, null, 2))
    log(`signed order as ${me === o.buyer.toLowerCase() ? 'buyer' : 'seller'} — send the JSON to the counterparty`)
  })

  const createOrder = act('create', async () => {
    const b = parseBundle()
    if (!b.sigBuyer || !b.sigSeller) throw new Error('Both signatures are required')
    const o = toOrder(b.order)
    await write(escrow, 'Escrow', 'createOrder', [o, b.sigBuyer, b.sigSeller])
    const id = await read<Hex>(escrow, 'Escrow', 'hashOrder', [o])
    setOrderId(id)
  })

  const cancelAuth = act('cancelAuth', async () => {
    await write(escrow, 'Escrow', 'cancelAuthorization', [toOrder(parseBundle().order)])
  })

  const sellerAuth = act('auth', async () => {
    if (!st) throw new Error('Load an order first')
    if (!isAddress(receiver)) throw new Error('Enter a valid receiver address')
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
        <h2>1 · Test assets (demo fixtures)</h2>
        <p className="sub">Your MPAY: <b>{e(payBal)}</b> · Escrow balance you can withdraw: <b>{e(claimable)}</b></p>
        <div className="row">
          <button className="sec" disabled={!!busy || !account} onClick={act('mintPay', () => write(dep!.pay as Address, 'MockPayToken', 'mint', [account!, parseEther('1000')]))}>Mint 1000 MPAY</button>
          <button className="sec" disabled={!!busy || !account} onClick={act('approvePay', () => write(dep!.pay as Address, 'MockPayToken', 'approve', [escrow, 2n ** 256n - 1n]))}>Approve MPAY → Escrow</button>
          <button className="sec" disabled={!!busy || !account} onClick={act('mintNft', async () => {
            const next = await read<bigint>(dep!.nft as Address, 'MockNFT', 'nextId')
            await write(dep!.nft as Address, 'MockNFT', 'mint', [account!]); setMintToken(String(next)); setTokenId(String(next))
          })}>Mint test NFT</button>
          <button className="sec" disabled={!!busy || !account} onClick={act('approveNft', () => write(dep!.nft as Address, 'MockNFT', 'setApprovalForAll', [escrow, true]))}>Approve NFT → Escrow</button>
          <button disabled={!!busy || claimable === 0n} onClick={act('withdraw', () => write(escrow, 'Escrow', 'withdraw', [dep!.pay]))}>Withdraw {e(claimable)}</button>
        </div>
        {mintToken && <p className="ok">Minted token #{mintToken}</p>}
      </div>

      <div className="card">
        <h2>2 · Compose and sign an order</h2>
        <p className="sub">Buyer and seller each deposit P. Success: NFT → buyer, seller can withdraw 2P. Zero protection period, no arbiter.</p>
        <div className="row">
          <input placeholder="buyer 0x…" value={buyer} onChange={(x) => setBuyer(x.target.value)} size={44} />
          <input placeholder="seller 0x…" value={seller} onChange={(x) => setSeller(x.target.value)} size={44} />
        </div>
        <div className="row">
          <label>P <input value={price} onChange={(x) => setPrice(x.target.value)} size={6} /> MPAY</label>
          <label>NFT id <input value={tokenId} onChange={(x) => setTokenId(x.target.value)} size={4} /></label>
          <label>fund within <input value={fundMin} onChange={(x) => setFundMin(x.target.value)} size={3} /> min</label>
          <label>then deliver within <input value={delMin} onChange={(x) => setDelMin(x.target.value)} size={3} /> min</label>
        </div>
        <div className="row">
          {account && <button className="sec" onClick={() => setBuyer(account)}>I am buyer</button>}
          {account && <button className="sec" onClick={() => setSeller(account)}>I am seller</button>}
          <button disabled={!!busy} onClick={buildOrder}>Build order</button>
        </div>
        <textarea value={bundleText} onChange={(x) => setBundleText(x.target.value)} placeholder="Order bundle JSON (paste the counterparty's bundle here)" />
        <div className="row">
          <button disabled={!!busy || !account || !bundleText} onClick={signBundle}>Sign as connected wallet</button>
          <button disabled={!!busy || !account || !bundleText} onClick={createOrder}>Create on-chain (needs both signatures)</button>
          <button className="sec" disabled={!!busy || !account || !bundleText} onClick={cancelAuth}>Cancel this authorization</button>
        </div>
      </div>

      <div className="card">
        <h2>3 · Order</h2>
        <div className="row">
          <input className="mono" placeholder="order id 0x…" value={orderId} onChange={(x) => setOrderId(x.target.value.trim())} size={70} />
        </div>
        {!st || stage === 0 ? <p className="mut">Enter an order id.</p> : (
          <>
            <div className="grid">
              <div className="stat">Stage<b>{STAGES[stage]}{awaiting && full ? ' · fully funded' : ''}</b></div>
              <div className="stat">Price P<b>{e(t.price)} MPAY</b></div>
              <div className="stat">NFT<b>#{String(t.tokenId)}</b></div>
              <div className="stat">Buyer funded<b className={st.buyerFunded ? 'ok' : ''}>{st.buyerFunded ? 'yes' : 'no'}</b></div>
              <div className="stat">Seller funded + NFT in custody<b className={st.sellerFunded ? 'ok' : ''}>{st.sellerFunded ? 'yes' : 'no'}</b></div>
              <div className="stat">Funding deadline F<b>{F - now > 0 ? `${F - now}s left` : 'passed'}</b></div>
              <div className="stat">Delivery deadline D<b>{D - now > 0 ? `${D - now}s left` : 'passed'}</b></div>
              <div className="stat">NFT recovery<b>{st.nftReturnPending ? 'pending' : '—'}</b></div>
            </div>
            <div className="row">
              <button disabled={!!busy || !awaiting || !isBuyer || st.buyerFunded || now >= F} onClick={act('fundBuyer', () => write(escrow, 'Escrow', 'fundBuyer', [orderId]))}>Fund as buyer</button>
              <button disabled={!!busy || !awaiting || !isSeller || st.sellerFunded || now >= F} onClick={act('fundSeller', () => write(escrow, 'Escrow', 'fundSeller', [orderId]))}>Fund as seller (+ NFT)</button>
              <button disabled={!!busy || !awaiting || !full || now >= D} onClick={act('complete', () => write(escrow, 'Escrow', 'complete', [orderId]))}>Complete delivery</button>
              <button className="sec" disabled={!!busy || !awaiting || full || now < F} onClick={act('fExit', () => write(escrow, 'Escrow', 'fundingTimeoutExit', [orderId]))}>Funding-timeout refund</button>
              <button className="sec" disabled={!!busy || !awaiting || !full || now < D} onClick={act('dExit', () => write(escrow, 'Escrow', 'deliveryTimeoutExit', [orderId]))}>Delivery-timeout refund</button>
              <button className="sec" disabled={!!busy || !awaiting || st.buyerFunded || st.sellerFunded || (!isBuyer && !isSeller)} onClick={act('cancel', () => write(escrow, 'Escrow', 'cancelUnfunded', [orderId]))}>Cancel (unfunded)</button>
            </div>
            {st.nftReturnPending && (
              <>
                <h2 style={{ marginTop: 12 }}>Recover NFT (separate from refunds)</h2>
                <div className="row">
                  <input placeholder="receiver 0x…" value={receiver} onChange={(x) => setReceiver(x.target.value)} size={44} />
                  {account && <button className="sec" onClick={() => setReceiver(account)}>me</button>}
                  <button disabled={!!busy || !isSeller} onClick={act('recover', () => write(escrow, 'Escrow', 'recoverNFT', [orderId, receiver]))}>Recover (original seller)</button>
                  <button className="sec" disabled={!!busy || !isSeller} onClick={sellerAuth}>Sign authorization for someone else</button>
                  <button className="sec" disabled={!!busy} onClick={execAuth}>Execute pasted authorization</button>
                </div>
              </>
            )}
          </>
        )}
        {err && <p className="bad">{err}</p>}
      </div>
    </>
  )
}
