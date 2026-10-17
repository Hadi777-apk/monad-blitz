// Solves the SHA-256 leading-zero puzzle off the main thread. Runs only after the user presses Start.
import { solve } from './solver.js'

type StartMsg = {
  type: 'start'
  params: { chainId: number; mining: string; round: string; seed: string; miner: string }
  bits: number
  startNonce: string
}

let running = false

self.onmessage = async (ev: MessageEvent<StartMsg | { type: 'stop' }>) => {
  const msg = ev.data
  if (msg.type === 'stop') {
    running = false
    return
  }
  running = true
  let nonce = BigInt(msg.startNonce)
  const params = { ...msg.params, round: BigInt(msg.params.round) }
  const BATCH = 20000
  while (running) {
    const found = solve(params, msg.bits, { startNonce: nonce, maxTries: BATCH })
    if (found !== null) {
      running = false
      ;(self as unknown as Worker).postMessage({ type: 'found', nonce: found.toString() })
      return
    }
    nonce += BigInt(BATCH)
    ;(self as unknown as Worker).postMessage({ type: 'progress', tried: nonce.toString() })
    await new Promise((r) => setTimeout(r, 0)) // yield so a 'stop' message can be delivered
  }
}
