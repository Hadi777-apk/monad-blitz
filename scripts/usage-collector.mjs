import { createServer } from 'node:http'
import { CodexUsageReader } from './codex-usage.mjs'
import { usageRuntime, viem, readJson, saveJson, json } from './usage-runtime.mjs'

const r = await usageRuntime()
const { config, pub, read, send } = r
const reader = new CodexUsageReader(config.sourceFile)
let status = { available: false, phase: '正在接入统计源', wallet: config.recipient, chainId: 31337 }
let fatal = false
let claimCursor = 0
const history = []
try {
  const previous = await readJson('cache/usage-runtime-state.json')
  if (previous.mining?.toLowerCase() === config.mining.toLowerCase()) history.push(...(previous.history ?? []).slice(0, 12))
} catch { /* First start has no local status cache. Accounting always comes from the chain. */ }
const tx = async (label, name, args = []) => {
  const hash = await send(name, args)
  history.unshift({ label, hash, at: new Date().toISOString() })
  history.splice(12)
  return hash
}
async function tick() {
  if (fatal) return
  let observed
  try { observed = await reader.poll() } catch (error) {
    fatal = true
    status = { ...status, available: false, phase: error.message }
    return
  }
  if (!observed) throw new Error('没有可用的 token 统计')
  let open = await read('openRoundId')
  let block = await pub.getBlock({ blockTag: 'latest' })
  if (open) {
    const round = await read('rounds', [open])
    if (block.timestamp >= round[0]) {
      await tx('自动结算', 'closeRound')
      open = 0n
    }
  }
  // Restart recovery: on-chain claimed flags are authoritative, not local checkpoints.
  const n = Number(await read('contributionCount'))
  while (claimCursor < n) {
    const c = await read('contributions', [BigInt(claimCursor)])
    const round = await read('rounds', [c[1]])
    if (!round[2]) break
    if (!c[4]) await tx('自动发币', 'claim', [BigInt(claimCursor)])
    claimCursor++
  }
  const source = await read('sources', [config.sourceId])
  if (BigInt(observed.eligible) < source[1]) {
    fatal = true
    status = { ...status, available: false, phase: '累计用量低于链上记录，已暂停计奖，请核对统计源。' }
    return
  }
  const remaining = await read('remaining')
  const validRounds = await read('validRounds')
  if (BigInt(observed.eligible) > source[1] && (open || (validRounds < 100n && remaining >= viem.parseEther('2')))) {
    if (!open) { await tx('自动开轮', 'openRound'); open = await read('openRoundId') }
    const reportId = viem.keccak256(viem.toHex(`31337:${config.mining}:${config.sourceId}:${observed.eligible}`))
    await tx('新增用量上链', 'reportUsage', [config.sourceId, BigInt(observed.eligible), reportId])
  }
  const eligible = await read('eligibleTokens', [config.recipient])
  open = await read('openRoundId')
  const round = open ? await read('rounds', [open]) : null
  block = await pub.getBlock({ blockTag: 'latest' })
  const [budget, reserve, unclaimed, paid, rounds, accounted, balance] = await Promise.all([
    ...['remaining', 'reserved', 'unclaimed', 'paid', 'validRounds', 'accountedTotal'].map(name => read(name)),
    pub.readContract({ address: config.token, abi: r.tokenAbi, functionName: 'balanceOf', args: [config.recipient] }),
  ])
  if (accounted !== viem.parseEther('200')) throw new Error('预算守恒异常，停止自动上报')
  status = {
    available: true, phase: rounds >= 100n ? '100 个有效轮已完成' : open ? '正在统计本轮新增用量，到期自动发币' : '等待新增 token 用量',
    chainId: 31337, source: '本次 Codex 聊天', wallet: config.recipient, mining: config.mining, token: config.token,
    symbol: 'UBLITZ', trustedReporter: config.reporter,
    baseline: config.baseline, observed, eligible: String(eligible), points: String(eligible / 1000n), remainder: String(eligible % 1000n),
    round: String(open), secondsLeft: round ? Math.max(0, Number(round[0] - block.timestamp)) : 0,
    roundPoints: round ? String(round[1]) : '0', validRounds: String(rounds),
    budget: viem.formatEther(budget), reserve: viem.formatEther(reserve), unclaimed: viem.formatEther(unclaimed),
    paid: viem.formatEther(paid), balance: viem.formatEther(balance), total: viem.formatEther(accounted),
    history: [...history], updatedAt: new Date().toISOString(),
  }
  await saveJson('cache/usage-runtime-state.json', status)
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== '/status') { res.writeHead(404).end(); return }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(json(status))
})
server.on('error', () => { console.error('采集服务端口不可用，未启动第二个采集器。'); process.exitCode = 1 })
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8787, '127.0.0.1', resolve) })
await saveJson('cache/usage-runtime-pid.json', { pid: process.pid, mining: config.mining })
console.log('本地 Codex 用量采集器已启动：http://127.0.0.1:8787/status')
let stopped = false
const stop = () => { stopped = true; server.close() }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
while (!stopped) {
  try { await tick() } catch {
    status = { ...status, available: false, phase: '采集或链上提交暂未完成，正在重试；以链上记录去重。' }
  }
  if (process.argv.includes('--once')) { stop(); break }
  await new Promise(resolve => setTimeout(resolve, 2000))
}
