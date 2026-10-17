import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Address } from 'viem'
import { chains, defaultChainId, deployments, publicClientFor, walletClientFor, abis, type Deployment } from './chain'

export interface Ctx {
  account?: Address
  walletChainId?: number
  chainId: number
  dep?: Deployment
  pub: ReturnType<typeof publicClientFor>
  connect: () => Promise<void>
  /** Sends a transaction, waits for the receipt and returns it; throws with a readable message on failure. */
  write: (address: Address, abiKey: keyof typeof abis, functionName: string, args?: unknown[]) => Promise<void>
  read: <T = any>(address: Address, abiKey: keyof typeof abis, functionName: string, args?: unknown[]) => Promise<T>
  sign: (typed: { domain: any; types: any; primaryType: string; message: any }) => Promise<`0x${string}`>
  log: (m: string) => void
  logs: string[]
}

export function useWallet(): Ctx {
  const [account, setAccount] = useState<Address>()
  const [walletChainId, setWalletChainId] = useState<number>()
  const [logs, setLogs] = useState<string[]>([])
  const chainId = walletChainId && walletChainId in chains ? walletChainId : defaultChainId()
  const pub = useMemo(() => publicClientFor(chainId), [chainId])
  const dep = deployments[String(chainId)]
  const log = useCallback((m: string) => setLogs((l) => [`${new Date().toLocaleTimeString()}  ${m}`, ...l].slice(0, 50)), [])

  useEffect(() => {
    const eth = window.ethereum
    if (!eth) return
    eth.request({ method: 'eth_chainId' }).then((c) => setWalletChainId(Number(c))).catch(() => {})
    eth.on?.('chainChanged', () => location.reload())
    eth.on?.('accountsChanged', () => location.reload())
  }, [])

  const connect = useCallback(async () => {
    if (!window.ethereum) throw new Error('No injected wallet found')
    const accts: string[] = await window.ethereum.request({ method: 'eth_requestAccounts' })
    setAccount(accts[0] as Address)
    setWalletChainId(Number(await window.ethereum.request({ method: 'eth_chainId' })))
  }, [])

  const requireReady = () => {
    if (!account) throw new Error('Connect a wallet first')
    if (walletChainId !== chainId) throw new Error(`Wrong network: switch the wallet to chain ${chainId}`)
    return account
  }

  const write: Ctx['write'] = async (address, abiKey, functionName, args = []) => {
    const acct = requireReady()
    try {
      const hash = await walletClientFor(chainId, acct).writeContract({
        address, abi: abis[abiKey], functionName, args, account: acct, chain: chains[chainId as keyof typeof chains],
      } as any)
      log(`${functionName}: submitted ${hash.slice(0, 12)}…`)
      const r = await pub.waitForTransactionReceipt({ hash })
      if (r.status !== 'success') throw new Error('transaction reverted')
      log(`${functionName}: confirmed in block ${r.blockNumber}`)
    } catch (e: any) {
      const msg = e?.shortMessage ?? e?.message ?? String(e)
      log(`${functionName}: FAILED — ${msg}`)
      throw new Error(msg)
    }
  }

  const read: Ctx['read'] = (address, abiKey, functionName, args = []) =>
    pub.readContract({ address, abi: abis[abiKey], functionName, args } as any) as Promise<any>

  const sign: Ctx['sign'] = async (typed) => {
    const acct = requireReady()
    return walletClientFor(chainId, acct).signTypedData({ account: acct, ...typed } as any)
  }

  return { account, walletChainId, chainId, dep, pub, connect, write, read, sign, log, logs }
}
