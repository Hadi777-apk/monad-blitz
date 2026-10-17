import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { scanUsage } from './usage.mjs'

const dir = process.env.BLITZ_COLLECTOR_STATE_DIR ?? resolve(process.env.LOCALAPPDATA??resolve(homedir(),'.local/share'),'BlitzUsage')
await mkdir(dir,{recursive:true})
const identityPath=resolve(dir,'device.json')
let machineId
try { machineId=JSON.parse(await readFile(identityPath,'utf8')).machineId } catch { machineId=randomUUID(); await writeFile(identityPath,JSON.stringify({machineId})) }
if(typeof machineId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(machineId)) throw new Error('本机标识无效')
let cached, inflight
async function summary(force=false) {
  if(!force&&cached&&Date.now()-Date.parse(cached.collectedAt)<10000) return cached
  if(!inflight) inflight=scanUsage(machineId,dir).then(s=>{cached=s;return s}).finally(()=>{inflight=undefined})
  return inflight
}
if(process.argv.includes('--export')) {
  const report=await summary(true)
  const output=resolve(process.cwd(),'AI-token-usage.json')
  await writeFile(output,JSON.stringify(report,null,2)+'\n')
  console.log('已导出不含正文和密钥的统计报告：'+output)
} else {
  const allowed=new Set(['https://monad.hardy777.top','http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:8788'])
  const server=createServer(async(req,res)=>{
    const host=req.headers.host
    if(!['127.0.0.1:8788','localhost:8788'].includes(host)) {res.writeHead(403).end();return}
    const origin=req.headers.origin
    if(origin&&!allowed.has(origin)) {res.writeHead(403).end();return}
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Private-Network':'true',...(origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{})}
    if(req.method==='OPTIONS') {res.writeHead(204,{...headers,'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}).end();return}
    if(req.method!=='GET') {res.writeHead(405,headers).end();return}
    if(req.url==='/health') {res.writeHead(200,{...headers,'Content-Type':'application/json'}).end(JSON.stringify({ok:true,name:'Blitz 本机 AI 用量采集器',schema:'blitz-ai-usage/v1'}));return}
    if(req.url==='/summary'||req.url==='/download') {
      try {
        const report=await summary()
        res.writeHead(200,{...headers,'Content-Type':'application/json; charset=utf-8',...(req.url==='/download'?{'Content-Disposition':'attachment; filename="AI-token-usage.json"'}:{})}).end(JSON.stringify(report))
      } catch {res.writeHead(503,{...headers,'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({error:'本机统计尚未完成或来源格式不兼容，请稍后重试。'}))}
      return
    }
    if(req.url==='/') {
      res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8'}).end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>本机 AI 用量采集器</title><style>body{font:16px/1.7 system-ui;max-width:800px;margin:40px auto;padding:16px}a{color:#6e48db}pre{white-space:pre-wrap}</style><h1>本机 AI 用量采集器</h1><p>仅提取可用的 token 统计，不上传聊天正文、代码或密钥，不登录云端账户。</p><p><a href="/download">下载 AI 用量报告</a> · <a href="https://monad.hardy777.top/">返回千枚矿场</a></p><pre id="result">正在读取本机统计，首次可能需要约一分钟…</pre><script>fetch('/summary').then(r=>r.json()).then(s=>{document.querySelector('#result').textContent=s.error||('本机累计：'+s.totals.total.toLocaleString('zh-CN')+' tokens\\n可计入新增奖励的累计基数：'+s.totals.eligible.toLocaleString('zh-CN')+' tokens\\n\\n'+s.sources.map(x=>x.label+'：'+x.total.toLocaleString('zh-CN')+' tokens').join('\\n'))}).catch(()=>document.querySelector('#result').textContent='统计暂不可用，请稍后刷新。')</script></html>`)
      return
    }
    res.writeHead(404,headers).end()
  })
  server.listen(8788,'127.0.0.1',()=>console.log('本机 AI 统计服务：http://127.0.0.1:8788（仅本机访问）'))
  server.on('error',()=>{console.error('端口 8788 已占用，未启动重复采集器。');process.exitCode=1})
}
