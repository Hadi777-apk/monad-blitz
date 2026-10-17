import { createPublicClient, createWalletClient, custom, defineChain, http, type Address, type Hex } from 'viem'
import { foundry } from 'viem/chains'
import abisJson from './abis.json'
import deploymentsJson from './deployments.json'

export const abis = abisJson as Record<'Mining' | 'BLITZ' | 'Escrow' | 'MockPayToken' | 'MockNFT', any>

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  // Primary RPC from the v0.5 baseline; the backup has not been verified.
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
})

export const chains = { [monadTestnet.id]: monadTestnet, [foundry.id]: foundry } as const

export interface Deployment {
  mining: Address
  blitz: Address
  escrow: Address
  pay: Address
  nft: Address
}

export const deployments = deploymentsJson as Record<string, Deployment>

declare global {
  interface Window {
    ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<any>; on?: (e: string, f: () => void) => void }
  }
}

/** Chain shown before a wallet connects: ?chain=31337 for the local demo, else Monad testnet. */
export function defaultChainId(): number {
  const q = new URLSearchParams(location.search).get('chain')
  return q ? Number(q) : monadTestnet.id
}

export function publicClientFor(chainId: number) {
  const chain = chains[chainId as keyof typeof chains]
  if (!chain) throw new Error(`Unsupported chain ${chainId}`)
  return createPublicClient({ chain, transport: http() })
}

export function walletClientFor(chainId: number, account: Address) {
  const chain = chains[chainId as keyof typeof chains]
  if (!window.ethereum) throw new Error('No injected wallet')
  return createWalletClient({ chain, account, transport: custom(window.ethereum) })
}

export const ZERO: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000'
