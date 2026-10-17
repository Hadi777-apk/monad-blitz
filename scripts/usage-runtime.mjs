import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(new URL('../web/package.json', import.meta.url))
export const viem = require('viem')
const { foundry } = require('viem/chains')
export const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2)
export const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'))
export const saveJson = (path, value) => writeFile(resolve(root, path), json(value) + '\n')

export async function localClients() {
  const transport = viem.http('http://127.0.0.1:8545')
  const pub = viem.createPublicClient({ chain: foundry, transport, pollingInterval: 500 })
  if (await pub.getChainId() !== 31337) throw new Error('仅允许本地链 31337')
  const [sender] = await pub.request({ method: 'eth_accounts' })
  if (!sender) throw new Error('本地开发链没有可用的公开测试账户')
  const wallet = viem.createWalletClient({ chain: foundry, transport, account: sender })
  return { pub, wallet, sender }
}

export async function usageRuntime() {
  const config = await readJson('cache/usage-config.json')
  const { pub, wallet, sender } = await localClients()
  const artifact = await readJson('out/UsageMining.sol/UsageMining.json')
  const tokenArtifact = await readJson('out/UsageMining.sol/UsageDemoToken.json')
  const read = (functionName, args = []) => pub.readContract({ address: config.mining, abi: artifact.abi, functionName, args })
  if ((await read('reporter')).toLowerCase() !== sender.toLowerCase()) throw new Error('本地上报账户不匹配')
  if ((await read('token')).toLowerCase() !== config.token.toLowerCase()) throw new Error('奖励资产不匹配')
  const send = async (functionName, args = []) => {
    const hash = await wallet.writeContract({ address: config.mining, abi: artifact.abi, functionName, args })
    const receipt = await pub.waitForTransactionReceipt({ hash, pollingInterval: 500 })
    if (receipt.status !== 'success') throw new Error('本地用量交易失败')
    return hash
  }
  return { config, pub, wallet, read, send, abi: artifact.abi, tokenAbi: tokenArtifact.abi }
}
