import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Address } from 'viem'
import { actionLabel, errorMessage } from './messages'
import { chains, defaultChainId, deployments, publicClientFor, walletClientFor, abis, type Deployment } from './chain'

export interface Ctx {
  account?: Address
  walletChainId?: number
  chainId: number
  dep?: Deployment
  pub: ReturnType<typeof publicClientFor>
  connect: () => Promise<void>
  setupLocalNetwork: () => Promise<void>
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
  const log = useCallback((m: string) => setLogs((l) => [`${new Date().toLocaleTimeString('zh-CN')}  ${m}`, ...l].slice(0, 50)), [])

  useEffect(() => {
    const eth = window.ethereum
    if (!eth) return
    eth.request({ method: 'eth_chainId' }).then((c) => setWalletChainId(Number(c))).catch(() => {})
    eth.on?.('chainChanged', () => location.reload())
    eth.on?.('accountsChanged', () => location.reload())
  }, [])

  const connect = useCallback(async () => {
    if (!window.ethereum) throw new Error('未检测到钱包扩展，请先安装并启用浏览器钱包。')
    const accts: string[] = await window.ethereum.request({ method: 'eth_requestAccounts' })
    setAccount(accts[0] as Address)
    setWalletChainId(Number(await window.ethereum.request({ method: 'eth_chainId' })))
  }, [])

  const setupLocalNetwork = useCallback(async () => {
    const eth = window.ethereum
    if (!eth) throw new Error('未检测到钱包扩展，请先安装并启用浏览器钱包。')
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x7a69' }] })
    } catch (error: any) {
      if (Number(error.code) !== 4902) throw error
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0x7a69',
          chainName: '本地测试链',
          nativeCurrency: { name: '测试以太币', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['http://127.0.0.1:8545'],
        }],
      })
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x7a69' }] })
    }
    const selected = Number(await eth.request({ method: 'eth_chainId' }))
    if (selected !== 31337) throw new Error('本地网络尚未切换成功，请在钱包中选择链 31337。')
    setWalletChainId(selected)
    log('已连接本地测试链（链 ID：31337）。')
  }, [log])

  const requireReady = () => {
    if (!account) throw new Error('请先连接钱包。')
    if (walletChainId !== chainId) throw new Error(`网络不匹配，请将钱包切换到链 ${chainId}。`)
    return account
  }

  const write: Ctx['write'] = async (address, abiKey, functionName, args = []) => {
    const acct = requireReady()
    try {
      const hash = await walletClientFor(chainId, acct).writeContract({
        address, abi: abis[abiKey], functionName, args, account: acct, chain: chains[chainId as keyof typeof chains],
      } as any)
      log(`${actionLabel(functionName)}：已提交，交易 ${hash.slice(0, 12)}…`)
      const r = await pub.waitForTransactionReceipt({ hash })
      if (r.status !== 'success') throw new Error('交易执行失败，链上操作已回退。')
      log(`${actionLabel(functionName)}：已确认，区块 ${r.blockNumber}`)
    } catch (e: any) {
      const msg = errorMessage(e)
      log(`${actionLabel(functionName)}失败：${msg}`)
      throw new Error(msg)
    }
  }

  const read: Ctx['read'] = (address, abiKey, functionName, args = []) =>
    pub.readContract({ address, abi: abis[abiKey], functionName, args } as any) as Promise<any>

  const sign: Ctx['sign'] = async (typed) => {
    const acct = requireReady()
    return walletClientFor(chainId, acct).signTypedData({ account: acct, ...typed } as any)
  }

  return { account, walletChainId, chainId, dep, pub, connect, setupLocalNetwork, write, read, sign, log, logs }
}
