// Reads forge broadcast output + build artifacts and writes web/src/deployments.json and web/src/abis.json.
// usage: node scripts/export-deployment.mjs <chainId>
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const chainId = process.argv[2]
if (!chainId) throw new Error('usage: export-deployment.mjs <chainId>')

const abis = {}
for (const [key, file, name] of [
  ['Mining', 'Mining.sol', 'Mining'],
  ['BLITZ', 'BLITZ.sol', 'BLITZ'],
  ['Escrow', 'Escrow.sol', 'Escrow'],
  ['MockPayToken', 'MockPayToken.sol', 'MockPayToken'],
  ['MockNFT', 'MockNFT.sol', 'MockNFT'],
]) {
  abis[key] = JSON.parse(readFileSync(`out/${file}/${name}.json`, 'utf8')).abi
}
writeFileSync('web/src/abis.json', JSON.stringify(abis))

const bc = JSON.parse(readFileSync(`broadcast/Deploy.s.sol/${chainId}/run-latest.json`, 'utf8'))
const created = bc.transactions.filter((t) => t.transactionType === 'CREATE')
const by = Object.fromEntries(created.map((t) => [t.contractName, t.contractAddress]))
// BLITZ is created inside Mining's constructor
const internal = bc.transactions.flatMap((t) => t.additionalContracts ?? [])
const blitz = internal.find((c) => c.contractName === 'BLITZ' || c.transactionType === 'CREATE')?.address

const path = 'web/src/deployments.json'
const all = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
all[chainId] = {
  mining: by.Mining,
  blitz,
  escrow: by.Escrow,
  pay: by.MockPayToken,
  nft: by.MockNFT,
}
writeFileSync(path, JSON.stringify(all, null, 2))
console.log(all[chainId])
