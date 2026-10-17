import { useCallback, useEffect, useState } from 'react'
import { parseAbi, type Address } from 'viem'
import { chains, publicClientFor, walletClientFor } from './chain'
import hub from './hub.json'

export const cfg = hub as { chainId: number; address?: string; factory?: string; faucet?: string; wmon?: string; archivedCampaigns?: string[] }
const archivedCampaigns = new Set(cfg.archivedCampaigns?.map((address) => address.toLowerCase()))
export const isArchivedCampaign = (address: string) => archivedCampaigns.has(address.toLowerCase())
export const chainId = cfg.chainId
export const pub = () => publicClientFor(chainId)

export const campaignAbi = parseAbi([
  'function registerEnd() view returns(uint64)', 'function reportEnd() view returns(uint64)', 'function claimEnd() view returns(uint64)',
  'function token() view returns(address)', 'function treasury() view returns(address)', 'function pool() view returns(uint256)',
  'function finalized() view returns(bool)', 'function totalUsage() view returns(uint256)',
  'function registered(address) view returns(bool)', 'function claimed(address) view returns(bool)', 'function usage(address) view returns(uint256)',
  'function participantCount() view returns(uint256)', 'function participants(uint256 offset,uint256 limit) view returns(address[])',
  'function register()', 'function report(uint256 cumulative)', 'function claim(address wallet) returns(uint256)',
  'function controller() view returns(address)', 'function skip()',
])
export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns(uint256)', 'function symbol() view returns(string)', 'function decimals() view returns(uint8)',
  'function allowance(address,address) view returns(uint256)', 'function approve(address,uint256) returns(bool)',
])
export const factoryAbi = parseAbi([
  'function campaignCount() view returns(uint256)', 'function latest(uint256 offset,uint256 limit) view returns(address[])',
  'function create(address token,uint256 pool,uint64 registerEnd,uint64 reportEnd,uint64 claimEnd) returns(address)',
  'function createDemo(address token,uint256 pool,uint64 registerEnd,uint64 reportEnd,uint64 claimEnd) returns(address)',
  'function isDemo(address) view returns(bool)',
  'event CampaignCreated(address indexed campaign,address indexed creator,address indexed token,uint256 pool,uint64 registerEnd,uint64 reportEnd,uint64 claimEnd)',
])
export const faucetAbi = parseAbi(['function faucet()', 'function lastDrip(address) view returns(uint256)'])
export const wmonAbi = parseAbi(['function deposit() payable'])

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
/** Token counts are shown in millions. */
export const M = (n: number | bigint) => `${(Number(n) / 1e6).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M`
export const hms = (secs: number) => {
  const d = Math.floor(secs / 86400), h = Math.floor(secs / 3600) % 24, m = Math.floor(secs / 60) % 60, s = secs % 60
  return `${d ? `${d}天` : ''}${h}时${m}分${d ? '' : `${s}秒`}`
}
export const phaseOf = (now: number, c: { registerEnd: number; reportEnd: number; claimEnd: number }) =>
  now < c.registerEnd ? 0 : now < c.reportEnd ? 1 : now < c.claimEnd ? 2 : 3
export const PHASES = ['报名中', '上报中', '领取中', '已结束']

export async function ensureChain() {
  const eth = window.ethereum
  if (!eth) throw new Error('未检测到钱包扩展。')
  const hex = '0x' + chainId.toString(16)
  try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] }) } catch (e: any) {
    if (Number(e.code) !== 4902) throw e
    const c = chains[chainId as keyof typeof chains]
    await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hex, chainName: c.name, nativeCurrency: c.nativeCurrency, rpcUrls: c.rpcUrls.default.http }] })
  }
}

/** Opens the wallet's account picker so the user can authorize a different account for this site. */
export async function switchAccount() {
  await window.ethereum!.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] })
}

/** Sends one transaction from the connected wallet and waits for it to be confirmed. */
export async function sendTx(account: Address, address: Address, abi: any, functionName: string, args: unknown[] = [], value?: bigint) {
  await ensureChain()
  const actual: string[] = await window.ethereum!.request({ method: 'eth_accounts' })
  if (actual[0]?.toLowerCase() !== account.toLowerCase()) throw new Error('钱包账户已切换，请刷新页面后重试。')
  const hash = await walletClientFor(chainId, account).writeContract({ address, abi, functionName, args, value, account, chain: chains[chainId as keyof typeof chains] } as any)
  const receipt = await pub().waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('交易执行失败，请检查活动阶段或余额。')
  return receipt
}

export function useAccount() {
  const [account, setAccount] = useState<Address>()
  const eth = window.ethereum
  useEffect(() => {
    if (!eth) return
    const sync = () => eth.request({ method: 'eth_accounts' }).then((a: string[]) => setAccount(a[0] as Address | undefined)).catch(() => {})
    sync()
    eth.on?.('accountsChanged', sync)
  }, [eth])
  const connect = useCallback(async () => {
    await ensureChain()
    const [a] = await window.ethereum!.request({ method: 'eth_requestAccounts' })
    setAccount(a)
  }, [])
  return { account, connect, hasWallet: !!eth }
}

/** Seconds since the page loaded, to tick countdowns between chain refreshes. */
export function useTick() {
  const [t, setT] = useState(0)
  useEffect(() => { const i = setInterval(() => setT((n) => n + 1), 1000); return () => clearInterval(i) }, [])
  return t
}
