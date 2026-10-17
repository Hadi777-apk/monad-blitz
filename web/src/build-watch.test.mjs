import {test} from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'
import ts from 'typescript'
test('old tab reloads on a new build; failed lazy chunks recover once without a loop',async()=>{
  const raw=fs.readFileSync(new URL('./build-watch.ts',import.meta.url),'utf8').replace(/import\.meta\.env\.DEV/g,'false')
  const source=ts.transpileModule(raw,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
  const listeners={},documentListeners={},store=new Map()
  let reloads=0,remote='0123456789abcdef',interval
  const context={__BUILD_ID__:'0123456789abcdef',checking:false,Date,fetch:async()=>({ok:true,json:async()=>({buildId:remote})}),sessionStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},location:{reload:()=>reloads++},window:{addEventListener:(n,f)=>listeners[n]=f},document:{hidden:false,addEventListener:(n,f)=>documentListeners[n]=f},setInterval:f=>{interval=f}}
  vm.runInNewContext(source,context)
  await new Promise(setImmediate);assert.equal(reloads,0)
  remote='fedcba9876543210';interval();await new Promise(setImmediate);assert.equal(reloads,1)
  interval();await new Promise(setImmediate);assert.equal(reloads,1)
  let prevented=0;listeners['vite:preloadError']({preventDefault:()=>prevented++});assert.equal(reloads,2)
  listeners['vite:preloadError']({preventDefault:()=>prevented++});assert.equal(reloads,2);assert.equal(prevented,2)
})
