import { CodexUsageReader } from './codex-usage.mjs'
import { localClients, viem, readJson, saveJson } from './usage-runtime.mjs'

const args = process.argv.slice(2)
const value = key => args[args.indexOf(key) + 1]
if (!args.includes('--source') || !args.includes('--wallet') || !args.includes('--session')) {
  throw new Error('用法：node scripts/deploy-usage.mjs --source <本次日志文件> --wallet <收款地址> --session <会话ID>')
}
const sourceFile = value('--source'), recipient = value('--wallet'), session = value('--session')
if (!viem.isAddress(recipient) || !sourceFile.includes(session)) throw new Error('收款地址或会话不匹配')
const reader = new CodexUsageReader(sourceFile)
const baseline = await reader.poll()
if (!baseline) throw new Error('未找到完整的 token 统计，不能建立基线')
const { pub, wallet, sender } = await localClients()
const artifact = await readJson('out/UsageMining.sol/UsageMining.json')
const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [sender, 60n] })
const receipt = await pub.waitForTransactionReceipt({ hash, pollingInterval: 500 })
if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('本地部署失败')
const mining = receipt.contractAddress
const read = (functionName, args = []) => pub.readContract({ address: mining, abi: artifact.abi, functionName, args })
const token = await read('token')
const sourceId = viem.keccak256(viem.toHex(`codex-session:${session}`))
const registration = await wallet.writeContract({ address: mining, abi: artifact.abi, functionName: 'registerSource', args: [sourceId, recipient, BigInt(baseline.eligible)] })
if ((await pub.waitForTransactionReceipt({ hash: registration, pollingInterval: 500 })).status !== 'success') throw new Error('基线注册失败')
await saveJson('cache/usage-config.json', { chainId: 31337, mining, token, reporter: sender, recipient, sourceId, sourceFile, baseline, deploymentBlock: receipt.blockNumber, deploymentTx: hash, registrationTx: registration })
console.log(JSON.stringify({ chainId: 31337, mining, token, symbol: 'UBLITZ', supply: 200, roundLength: 60, baselineEligible: baseline.eligible }))
