import assert from 'node:assert/strict'
import { usageRuntime, viem, readJson, saveJson } from './usage-runtime.mjs'

const { config, pub, abi, tokenAbi } = await usageRuntime()
// One fixed block: continuous collection must not create inconsistent cross-block reads.
const blockNumber = await pub.getBlockNumber({ cacheTime: 0 })
const read = (functionName, args = []) => pub.readContract({ address: config.mining, abi, functionName, args, blockNumber })
const logs = viem.parseEventLogs({ abi, logs: await pub.getLogs({ address: config.mining, fromBlock: BigInt(config.deploymentBlock), toBlock: blockNumber }) })
const registrations = logs.filter(e => e.eventName === 'SourceRegistered')
assert.equal(registrations.length, 1)
assert.equal(registrations[0].args.baseline, BigInt(config.baseline.eligible))
assert.equal(registrations[0].args.wallet.toLowerCase(), config.recipient.toLowerCase())
const reports = logs.filter(e => e.eventName === 'UsageRecorded')
assert(reports.length > 0, 'Real usage must be reported')
assert.equal(new Set(reports.map(e => e.args.reportId)).size, reports.length, 'No duplicate reports')
let delta = 0n
for (const report of reports) {
  assert.equal(report.args.source, config.sourceId)
  assert.equal(report.args.wallet.toLowerCase(), config.recipient.toLowerCase())
  assert(report.args.delta > 0n)
  delta += report.args.delta
}
const source = await read('sources', [config.sourceId])
const eligible = await read('eligibleTokens', [config.recipient])
assert.equal(source[1] - BigInt(config.baseline.eligible), delta, 'Only increments after baseline count')
assert.equal(eligible, delta)
const contributions = logs.filter(e => e.eventName === 'ContributionRecorded')
assert.equal(contributions.reduce((sum, e) => sum + e.args.points, 0n), eligible / 1000n)
const claims = logs.filter(e => e.eventName === 'Claimed')
assert(claims.length > 0, 'Automatic payout must complete')
assert.equal(new Set(claims.map(e => String(e.args.id))).size, claims.length, 'No repeat payout')
for (const c of claims) assert.equal(c.args.owner.toLowerCase(), config.recipient.toLowerCase())
const paidFromEvents = claims.reduce((sum, e) => sum + e.args.amount, 0n)
const names = ['remaining', 'reserved', 'unclaimed', 'paid', 'validRounds', 'accountedTotal']
const [remaining, reserved, unclaimed, paid, rounds, total] = await Promise.all(names.map(n => read(n)))
assert.equal(paidFromEvents, paid)
assert.equal(total, viem.parseEther('200'))
assert.equal(remaining + reserved + unclaimed + paid, total)
assert.equal(unclaimed + paid, rounds * viem.parseEther('2'))
const balance = await pub.readContract({ address: config.token, abi: tokenAbi, functionName: 'balanceOf', args: [config.recipient], blockNumber })
assert.equal(balance, paidFromEvents, 'Fixed beneficiary receives payouts')
assert.equal(await pub.readContract({ address: config.token, abi: tokenAbi, functionName: 'totalSupply', blockNumber }), total)
const hashes = [...new Set(logs.map(e => e.transactionHash))]
await Promise.all(hashes.map(async hash => {
  const receipt = await pub.getTransactionReceipt({ hash })
  assert.equal(receipt.status, 'success')
  assert.equal(receipt.from.toLowerCase(), config.reporter.toLowerCase())
}))
const original = (await readJson('web/src/deployments.json'))['31337']
const a = await readJson('web/src/abis.json')
const originalBalance = await pub.readContract({ address: original.blitz, abi: a.BLITZ, functionName: 'balanceOf', args: [config.recipient], blockNumber })
assert.equal(originalBalance, viem.parseEther('8'), 'Original A reward preserved')
assert.equal(await pub.readContract({ address: original.mining, abi: a.Mining, functionName: 'LOCKED_B', blockNumber }), viem.parseEther('200'))
const result = { verifiedAtBlock: String(blockNumber), chainId: 31337, wallet: config.recipient, mining: config.mining, token: config.token,
  baselineEligible: config.baseline.eligible, newEligibleTokens: String(eligible), points: String(eligible / 1000n), remainder: String(eligible % 1000n),
  uniqueReports: reports.length, uniqueClaims: claims.length, paidUBLITZ: viem.formatEther(paid), walletUBLITZ: viem.formatEther(balance),
  validRounds: String(rounds), totalSupply: '200', budgetConserved: true, historicalUsageRewarded: false,
  originalBLITZ: viem.formatEther(originalBalance), originalBLocked: '200', firstPayoutTx: claims[0].transactionHash }
await saveJson('cache/usage-verified.json', result)
console.log(JSON.stringify({ ...result, wallet: '0x9ab7…7767' }, null, 2))
