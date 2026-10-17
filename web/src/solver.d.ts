export function solve(
  params: { chainId: number; mining: string; round: bigint; seed: string; miner: string },
  bits: number,
  opts?: { startNonce?: bigint; maxTries?: number; shouldStop?: () => boolean },
): bigint | null
