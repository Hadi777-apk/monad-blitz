import {createRequire} from 'node:module'
import {readFile,writeFile} from 'node:fs/promises'
const require=createRequire(new URL('../web/package.json',import.meta.url))
const {createPublicClient,http,parseAbi,getContractAddress,encodeDeployData,encodeFunctionData,parseEther,toHex}=require('viem')
const p=createPublicClient({transport:http('https://testnet-rpc.monad.xyz',{timeout:15000}),pollingInterval:500})
if(await p.getChainId()!==10143) throw new Error('Unexpected chain')
const from='0x9ab7c05b6c9796ead06860855fe87faf492c7767'
const old=JSON.parse(await readFile(new URL('../web/src/hub.json',import.meta.url),'utf8'))
const treasury=await p.readContract({address:old.address,abi:parseAbi(['function treasury() view returns(address)']),functionName:'treasury'})
const [nonce,pending,balance,block]=await Promise.all([p.getTransactionCount({address:from}),p.getTransactionCount({address:from,blockTag:'pending'}),p.getBalance({address:from}),p.getBlock()])
if(nonce!==pending||balance<parseEther('0.5')) throw new Error('Pending transaction or insufficient testnet funding')
const tokenArtifact=JSON.parse(await readFile(new URL('../out/UsageMining.sol/UsageDemoToken.json',import.meta.url),'utf8'))
const distributionArtifact=JSON.parse(await readFile(new URL('../out/Distribution.sol/Distribution.json',import.meta.url),'utf8'))
if(distributionArtifact.abi.some(a=>a.name==='perWalletCap')||distributionArtifact.abi.find(a=>a.type==='constructor').inputs.length!==5) throw new Error('Wrong Distribution artifact')
const token=getContractAddress({from,nonce:BigInt(nonce)}),distribution=getContractAddress({from,nonce:BigInt(nonce+1)})
const registerEnd=block.timestamp+3600n, reportEnd=registerEnd+3600n, claimEnd=reportEnd+7n*86400n
const steps=[
 {label:'部署新奖励代币（200 UBLITZ）',expectedAddress:token,tx:{from,nonce:toHex(nonce),value:'0x0',data:encodeDeployData({abi:tokenArtifact.abi,bytecode:tokenArtifact.bytecode.object})}},
 {label:'部署没有单人上限的新活动',expectedAddress:distribution,tx:{from,nonce:toHex(nonce+1),value:'0x0',data:encodeDeployData({abi:distributionArtifact.abi,bytecode:distributionArtifact.bytecode.object,args:[token,treasury,registerEnd,reportEnd,claimEnd]})}},
 {label:'注入 200 UBLITZ 新奖池',tx:{from,to:token,nonce:toHex(nonce+2),value:'0x0',data:encodeFunctionData({abi:tokenArtifact.abi,functionName:'transfer',args:[distribution,parseEther('200')]})}},
]
const plan={chainId:10143,from,previous:old,token,distribution,treasury,registerEnd:String(registerEnd),reportEnd:String(reportEnd),claimEnd:String(claimEnd),steps}
await writeFile(new URL('../cache/distribution-upgrade-plan.json',import.meta.url),JSON.stringify(plan,null,2))
await writeFile(new URL('../cache/hub-before-upgrade.json',import.meta.url),JSON.stringify(old,null,2))
console.log(JSON.stringify({from,token,distribution,treasury,nonce,steps:steps.map(s=>({label:s.label,bytes:(s.tx.data.length-2)/2}))},null,2))
