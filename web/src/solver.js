import { sha256 } from '@noble/hashes/sha256'

const hex = (h) => Uint8Array.from(h.replace(/^0x/, '').match(/../g) ?? [], (b) => parseInt(b, 16))

function putUint256(buf, offset, value) {
  let v = BigInt(value)
  for (let i = 31; i >= 0; i--) {
    buf[offset + i] = Number(v & 0xffn)
    v >>= 8n
  }
}

/** True if the first `bits` bits of the digest are zero. */
export function hasLeadingZeroBits(digest, bits) {
  const full = bits >> 3
  for (let i = 0; i < full; i++) if (digest[i] !== 0) return false
  const rem = bits & 7
  return rem === 0 || (digest[full] >> (8 - rem)) === 0
}

/**
 * Preimage matches Mining.answerDigest:
 * abi.encodePacked(chainid u256, mining addr, round u256, seed b32, miner addr, nonce u256) = 168 bytes.
 */
export function buildPreimage({ chainId, mining, round, seed, miner }) {
  const buf = new Uint8Array(168)
  putUint256(buf, 0, chainId)
  buf.set(hex(mining), 32)
  putUint256(buf, 52, round)
  buf.set(hex(seed), 84)
  buf.set(hex(miner), 116)
  return buf
}

export function digestFor(params, nonce) {
  const buf = buildPreimage(params)
  putUint256(buf, 136, nonce)
  return sha256(buf)
}

/**
 * Search nonces from `startNonce`. Returns the nonce or null if `shouldStop()` or maxTries hit.
 * Synchronous inner loop; callers that need responsiveness run it in a Worker.
 */
export function solve(params, bits, { startNonce = 0n, maxTries = Infinity, shouldStop = () => false } = {}) {
  const buf = buildPreimage(params)
  let nonce = BigInt(startNonce)
  for (let i = 0; i < maxTries; i++) {
    putUint256(buf, 136, nonce)
    if (hasLeadingZeroBits(sha256(buf), bits)) return nonce
    nonce += 1n
    if ((i & 0x3fff) === 0x3fff && shouldStop()) return null
  }
  return null
}
