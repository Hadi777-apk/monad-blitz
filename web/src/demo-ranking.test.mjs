import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankingRows } from './demo-ranking.ts'

test('demo fixtures stay stable, rank with real reports, and never alter chain rows', () => {
  const real = [{ wallet: '0x123', usage: 13_000_000_000n }]
  const before = structuredClone(real)
  const rows = rankingRows('0xabc', real, true)
  assert.equal(rows.length, 11)
  assert.equal(rows.filter(row => row.simulated).length, 10)
  assert.ok(rows.filter(row => row.simulated).every(row => !row.wallet && row.label.startsWith('模拟玩家') && row.usage >= 100_000_000n && row.usage < 20_000_000_000n))
  assert.deepEqual(rows, rankingRows('0xABC', real, true))
  assert.notDeepEqual(rows, rankingRows('0xdef', real, true))
  assert.ok(rows.every((row, i) => !i || rows[i - 1].usage >= row.usage))
  const total = rows.reduce((sum, row) => sum + row.usage, 0n)
  const basisPoints = rows.reduce((sum, row) => sum + row.usage * 10000n / total, 0n)
  assert.ok(basisPoints <= 10000n && basisPoints > 10000n - BigInt(rows.length))
  assert.deepEqual(real, before)
  assert.deepEqual(rankingRows('0xabc', real, false), [{ ...real[0], id: real[0].wallet, simulated: false }])
  assert.equal(rankingRows('0xabc', [], true).length, 10)
})
