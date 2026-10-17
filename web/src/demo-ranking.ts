type ChainRow = { wallet: string; usage: bigint }
export type RankingRow = { id: string; wallet?: string; label?: string; usage: bigint; simulated: boolean }

/** Stable random fixtures for one campaign. These values are never sent to the contract. */
export function rankingRows(campaign: string, chainRows: ChainRow[], demo: boolean): RankingRow[] {
  const rows: RankingRow[] = chainRows.map((row) => ({ ...row, id: row.wallet, simulated: false }))
  if (demo) {
    let seed = 2166136261
    for (const char of campaign.toLowerCase()) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0
    for (let i = 1; i <= 10; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      rows.push({ id: `demo-${i}`, label: `模拟玩家 ${String(i).padStart(2, '0')}`, usage: BigInt(100_000_000 + Math.floor(seed / 4294967296 * 19_900_000_000)), simulated: true })
    }
  }
  return rows.sort((a, b) => a.usage === b.usage ? a.id.localeCompare(b.id) : a.usage > b.usage ? -1 : 1)
}
