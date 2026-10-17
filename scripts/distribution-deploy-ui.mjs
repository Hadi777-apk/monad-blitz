import {createServer} from 'node:http'
import {createRequire} from 'node:module'
import {readFile,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const require=createRequire(new URL('../web/package.json',import.meta.url))
const {createPublicClient,http}=require('viem')
const p=createPublicClient({transport:http('https://testnet-rpc.monad.xyz',{timeout:15000}),pollingInterval:500})
const plan=JSON.parse(await readFile(new URL('../cache/distribution-upgrade-plan.json',import.meta.url),'utf8'))
const output=new URL('../cache/distribution-upgrade-result.json',import.meta.url)
let results=[]
try{const previous=JSON.parse(await readFile(output,'utf8'));if(previous.distribution===plan.distribution)results=previous.results}catch{}
const server=createServer(async(req,res)=>{
  if(!['127.0.0.1:8789','localhost:8789'].includes(req.headers.host)){res.writeHead(403).end();return}
  if(req.headers.origin&&!['http://127.0.0.1:8789','http://localhost:8789'].includes(req.headers.origin)){res.writeHead(403).end();return}
  res.setHeader('Cache-Control','no-store')
  if(req.method==='GET'&&req.url==='/plan'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...plan,results}));return}
  if(req.method==='POST'&&req.url==='/record'){
    try{
      let raw='';for await(const c of req){raw+=c;if(raw.length>1024)throw Error('Request too large')}
      const {index,hash}=JSON.parse(raw);assert(Number.isInteger(index)&&index===results.length&&index<plan.steps.length)
      assert(/^0x[0-9a-f]{64}$/i.test(hash));assert.equal(await p.getChainId(),10143)
      const receipt=await p.waitForTransactionReceipt({hash,timeout:60000,pollingInterval:500})
      const tx=await p.getTransaction({hash});const expected=plan.steps[index]
      assert.equal(receipt.status,'success');assert.equal(tx.from.toLowerCase(),plan.from.toLowerCase());assert.equal(tx.value,0n)
      assert.equal(tx.input.toLowerCase(),expected.tx.data.toLowerCase());assert.equal(tx.nonce,Number(BigInt(expected.tx.nonce)))
      if(expected.tx.to)assert.equal(tx.to.toLowerCase(),expected.tx.to.toLowerCase())
      else assert.equal(receipt.contractAddress.toLowerCase(),expected.expectedAddress.toLowerCase())
      results.push({index,label:expected.label,hash,block:String(receipt.blockNumber),status:receipt.status})
      await writeFile(output,JSON.stringify({...plan,steps:undefined,results},null,2))
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,results}));return
    }catch{res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({error:'交易尚未确认，或与预定部署不一致；未推进下一步。'}));return}
  }
  if(req.method!=='GET'||req.url!=='/'){res.writeHead(404).end();return}
  res.setHeader('Content-Type','text/html; charset=utf-8')
  res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Monad 测试网部署</title><style>body{font:16px/1.7 system-ui;max-width:900px;margin:40px auto;padding:20px}button{font:inherit;padding:10px;background:#7c5cff;color:white;border:0;border-radius:8px}pre{white-space:pre-wrap;word-break:break-all}</style><h1>部署无单人上限的新活动</h1><p>仅 Monad 测试网（10143），只使用当前已授权的钱包。旧活动保留在原合约，新活动使用独立的 200 UBLITZ。</p><pre id="details">正在读取部署方案…</pre><button id="send" disabled>加载中</button><p id="status" role="status"></p><script>
let plan;const button=document.querySelector('#send'),status=document.querySelector('#status');
async function load(){plan=await(await fetch('/plan')).json();document.querySelector('#details').textContent='部署钱包：'+plan.from+'\\n新活动：'+plan.distribution+'\\n新代币：'+plan.token+'\\n剩余资金接收地址：'+plan.treasury+'\\n已完成 '+plan.results.length+' / '+plan.steps.length;button.textContent=plan.steps[plan.results.length]?.label||'三步部署已完成';button.disabled=plan.results.length>=plan.steps.length}
button.onclick=async()=>{button.disabled=true;try{if(!window.ethereum)throw Error('没有检测到钱包');await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x279f'}]});const accounts=await window.ethereum.request({method:'eth_requestAccounts'});if(accounts[0]?.toLowerCase()!==plan.from.toLowerCase())throw Error('请切换到部署方案中的钱包');if(await window.ethereum.request({method:'eth_chainId'})!=='0x279f')throw Error('网络不匹配');const index=plan.results.length;status.textContent='等待钱包确认：'+plan.steps[index].label;const hash=await window.ethereum.request({method:'eth_sendTransaction',params:[plan.steps[index].tx]});status.textContent='已提交 '+hash+'，正在核对回执…';const r=await fetch('/record',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({index,hash})});const v=await r.json();if(!r.ok)throw Error(v.error);status.textContent='已确认：'+hash;await load()}catch(e){status.textContent=e.message;button.disabled=false}};load();
</script></html>`)
})
server.listen(8789,'127.0.0.1',()=>console.log('本地部署操作页：http://127.0.0.1:8789'))
