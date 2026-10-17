// End-to-end check against a local anvil node with the contracts deployed (see README).
// usage: node scripts/e2e.mjs   (from web/)
import { readFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { solve } from '../src/solver.js'

const abis = JSON.parse(readFileSync('src/abis.json', 'utf8'))
const dep = JSON.parse(readFileSync('src/deployments.json', 'utf8'))['31337']
const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545'

// anvil's default dev accounts #1 and #2, derived from its public dev mnemonic (local chain only)
const DEV_MNEMONIC = 'test test test test test test test test test test test junk'
const alice = mnemonicToAccount(DEV_MNEMONIC, { addressIndex: 1 })
const bob = mnemonicToAccount(DEV_MNEMONIC, { addressIndex: 2 })

const pub = createPublicClient({ chain: foundry, transport: http(RPC) })
const wallet = (account) => createWalletClient({ account, chain: foundry, transport: http(RPC) })
const rpc = (method, params = []) => pub.request({ method, params })

const assert = (cond, msg) => {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg)
  console.log('  ok  ' + msg)
}
async function send(account, address, abiKey, functionName, args = []) {
  const hash = await wallet(account).writeContract({ address, abi: abis[abiKey], functionName, args })
  const rcpt = await pub.waitForTransactionReceipt({ hash })
  if (rcpt.status !== 'success') throw new Error(`${functionName} reverted`)
  return rcpt
}
const read = (address, abiKey, functionName, args = []) => pub.readContract({ address, abi: abis[abiKey], functionName, args })
const warp = async (secs) => {
  await rpc('evm_increaseTime', [secs])
  await rpc('evm_mine')
}
const now = async () => Number((await pub.getBlock()).timestamp)

async function mining() {
  console.log('\n== Mining ==')
  const bits = Number(await read(dep.mining, 'Mining', 'difficultyBits'))
  const chainId = await pub.getChainId()
  await send(alice, dep.mining, 'Mining', 'openRound')
  const roundId = await read(dep.mining, 'Mining', 'openRoundId')
  const round = await read(dep.mining, 'Mining', 'rounds', [roundId])
  const seed = round[0]
  console.log(`  round ${roundId}, difficulty ${bits} bits, seed ${seed.slice(0, 10)}…`)

  for (const who of [alice, bob, bob]) {
    const nonce = solve({ chainId, mining: dep.mining, round: roundId, seed, miner: who.address }, bits, {
      startNonce: who === bob && who.__n ? who.__n : 0n,
    })
    who.__n = nonce + 1n
    // the on-chain digest must agree with the JS solver
    await send(who, dep.mining, 'Mining', 'submit', [nonce])
  }
  const total = (await read(dep.mining, 'Mining', 'rounds', [roundId]))[3]
  assert(total === 3, 'three answers accepted on chain (1 point each)')

  await warp(30) // past the 20s demo round
  await send(alice, dep.mining, 'Mining', 'closeRound')
  assert((await read(dep.mining, 'Mining', 'validRounds')) === 1n, 'non-empty round counts toward the 100')

  const ids = [0n, 1n, 2n]
  await send(alice, dep.mining, 'Mining', 'claimMany', [ids])
  const a = await read(dep.blitz, 'BLITZ', 'balanceOf', [alice.address])
  const b = await read(dep.blitz, 'BLITZ', 'balanceOf', [bob.address])
  console.log(`  alice ${formatEther(a)} BLITZ, bob ${formatEther(b)} BLITZ`)
  assert(a + b === parseEther('8'), 'claims sum to exactly 8 BLITZ')
  assert((await read(dep.mining, 'Mining', 'accountedTotal')) === parseEther('1000'), 'R+E+U+C+L_B == 1000')

  // empty round: budget returns, quota not consumed
  await send(alice, dep.mining, 'Mining', 'openRound')
  await warp(30)
  await send(alice, dep.mining, 'Mining', 'closeRound')
  assert((await read(dep.mining, 'Mining', 'validRounds')) === 1n, 'empty round did not use quota')
  assert((await read(dep.mining, 'Mining', 'remainingA')) === parseEther('792'), 'empty round budget returned (800 - 8)')
}

const domain = () => ({ name: 'MonadBlitzEscrow', version: '1', chainId: 31337, verifyingContract: dep.escrow })
const orderTypes = {
  Order: [
    { name: 'buyer', type: 'address' },
    { name: 'seller', type: 'address' },
    { name: 'paymentAsset', type: 'address' },
    { name: 'price', type: 'uint256' },
    { name: 'nft', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'fundingDeadline', type: 'uint64' },
    { name: 'deliveryDeadline', type: 'uint64' },
    { name: 'version', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
}
const recoverTypes = {
  RecoverNFT: [
    { name: 'orderId', type: 'bytes32' },
    { name: 'nft', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'receiver', type: 'address' },
    { name: 'action', type: 'bytes32' },
    { name: 'version', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
  ],
}

async function newOrder(buyer, seller, nonce) {
  const mintRcpt = await send(seller, dep.nft, 'MockNFT', 'mint', [seller.address])
  const tokenId = (await read(dep.nft, 'MockNFT', 'nextId')) - 1n
  void mintRcpt
  const t = await now()
  const order = {
    buyer: buyer.address, seller: seller.address, paymentAsset: dep.pay, price: parseEther('100'),
    nft: dep.nft, tokenId, fundingDeadline: BigInt(t + 600), deliveryDeadline: BigInt(t + 900),
    version: 1n, nonce: BigInt(nonce),
  }
  const sigB = await buyer.signTypedData({ domain: domain(), types: orderTypes, primaryType: 'Order', message: order })
  const sigS = await seller.signTypedData({ domain: domain(), types: orderTypes, primaryType: 'Order', message: order })
  await send(buyer, dep.escrow, 'Escrow', 'createOrder', [order, sigB, sigS])
  const id = await read(dep.escrow, 'Escrow', 'hashOrder', [order])
  // the viem EIP-712 digest must equal the contract's
  return { order, id }
}

async function escrow() {
  console.log('\n== Escrow ==')
  const buyer = bob, seller = alice
  await send(buyer, dep.pay, 'MockPayToken', 'mint', [buyer.address, parseEther('1000')])
  await send(seller, dep.pay, 'MockPayToken', 'mint', [seller.address, parseEther('1000')])
  await send(buyer, dep.pay, 'MockPayToken', 'approve', [dep.escrow, 2n ** 256n - 1n])
  await send(seller, dep.pay, 'MockPayToken', 'approve', [dep.escrow, 2n ** 256n - 1n])
  await send(seller, dep.nft, 'MockNFT', 'setApprovalForAll', [dep.escrow, true])
  const bal = (a) => read(dep.pay, 'MockPayToken', 'balanceOf', [a])

  // 1. happy path
  const s0 = await bal(seller.address), b0 = await bal(buyer.address)
  let { order, id } = await newOrder(buyer, seller, 1)
  assert(id !== undefined, 'order created from two EIP-712 signatures (signature digest matches contract)')
  await send(buyer, dep.escrow, 'Escrow', 'fundBuyer', [id])
  await send(seller, dep.escrow, 'Escrow', 'fundSeller', [id])
  assert((await read(dep.nft, 'MockNFT', 'ownerOf', [order.tokenId])).toLowerCase() === dep.escrow, 'NFT actually held by Escrow')
  await send(alice, dep.escrow, 'Escrow', 'complete', [id])
  assert((await read(dep.nft, 'MockNFT', 'ownerOf', [order.tokenId])) === buyer.address, 'NFT delivered to buyer')
  assert((await read(dep.escrow, 'Escrow', 'balances', [seller.address, dep.pay])) === parseEther('200'), 'seller can withdraw 2P')
  await send(seller, dep.escrow, 'Escrow', 'withdraw', [dep.pay])
  assert((await bal(seller.address)) - s0 === parseEther('100'), 'seller net +P (deposit back + payment)')
  assert(b0 - (await bal(buyer.address)) === parseEther('100'), 'buyer net -P')

  // 2. delivery timeout: refund + separate NFT recovery with third-party authorization
  ;({ order, id } = await newOrder(buyer, seller, 2))
  await send(buyer, dep.escrow, 'Escrow', 'fundBuyer', [id])
  await send(seller, dep.escrow, 'Escrow', 'fundSeller', [id])
  await warp(901)
  let reverted = false
  try { await send(alice, dep.escrow, 'Escrow', 'complete', [id]) } catch { reverted = true }
  assert(reverted, 'complete is rejected after the delivery deadline')
  await send(bob, dep.escrow, 'Escrow', 'deliveryTimeoutExit', [id])
  assert((await read(dep.escrow, 'Escrow', 'balances', [buyer.address, dep.pay])) === parseEther('100'), 'buyer credited P')
  assert((await read(dep.escrow, 'Escrow', 'balances', [seller.address, dep.pay])) === parseEther('100'), 'seller credited P')
  assert((await read(dep.nft, 'MockNFT', 'ownerOf', [order.tokenId])).toLowerCase() === dep.escrow, 'exit did not touch the NFT')

  const receiver = '0x000000000000000000000000000000000000bEEF'
  const expiry = BigInt((await now()) + 3600)
  const authMsg = {
    orderId: id, nft: dep.nft, tokenId: order.tokenId, receiver,
    action: await read(dep.escrow, 'Escrow', 'RECOVER_ACTION'), version: 1n, nonce: 1n, expiry,
  }
  const auth = await seller.signTypedData({ domain: domain(), types: recoverTypes, primaryType: 'RecoverNFT', message: authMsg })
  await send(bob, dep.escrow, 'Escrow', 'recoverNFTWithAuth', [id, receiver, 1n, expiry, auth]) // bob executes seller's authorization
  assert((await read(dep.nft, 'MockNFT', 'ownerOf', [order.tokenId])).toLowerCase() === receiver.toLowerCase(), 'NFT recovered to seller-authorized receiver')
  reverted = false
  try { await send(bob, dep.escrow, 'Escrow', 'recoverNFTWithAuth', [id, receiver, 1n, expiry, auth]) } catch { reverted = true }
  assert(reverted, 'authorization cannot be replayed')
  await send(seller, dep.escrow, 'Escrow', 'withdraw', [dep.pay])
  await send(buyer, dep.escrow, 'Escrow', 'withdraw', [dep.pay])
  assert((await bal(dep.escrow)) === 0n, 'escrow holds no payment funds at the end')
}

await mining()
await escrow()
console.log('\nE2E PASSED')
process.exit(0)
