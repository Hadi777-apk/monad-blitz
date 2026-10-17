import {test} from 'node:test'
import assert from 'node:assert/strict'
import {validateSummary,updateBaseline} from './usage-summary.ts'
const snapshot = entries => validateSummary({schema:'blitz-ai-usage/v1',machineId:'test-device-0000001',sources:entries.map(([id,n])=>({id,label:id,total:n,eligible:n,quality:'recorded'})),totals:{total:entries.reduce((s,x)=>s+x[1],0),eligible:entries.reduce((s,x)=>s+x[1],0)}})
test('first import excludes history; duplicate/restart/disappearing source/new source never invent usage',()=>{
  let r=updateBaseline(snapshot([['codex',5000],['claude',8000]]));assert.equal(r.earned,0)
  r=updateBaseline(snapshot([['codex',6000],['claude',8500]]),r.next);assert.equal(r.earned,1500)
  r=updateBaseline(snapshot([['codex',6000]]),JSON.parse(JSON.stringify(r.next)));assert.equal(r.earned,1500)
  r=updateBaseline(snapshot([['codex',6000],['claude',8500],['pi',900000]]),r.next);assert.equal(r.earned,1500)
  r=updateBaseline(snapshot([['codex',100],['pi',900500]]),r.next);assert.equal(r.earned,2000);assert.deepEqual(r.rollback,['codex'])
})
test('bad totals, duplicate sources and estimated reward numbers are rejected',()=>{
  const s=snapshot([['codex',10]]);s.totals.total=9;assert.throws(()=>validateSummary(s))
  const t=snapshot([['codex',10]]);t.sources.push({...t.sources[0]});assert.throws(()=>validateSummary(t))
  const e=snapshot([['codex',10]]);e.sources[0].quality='estimated';assert.throws(()=>validateSummary(e))
})
