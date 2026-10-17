import {test} from 'node:test'
import assert from 'node:assert/strict'
import {normalizeReport} from './usage.mjs'
test('merge client rows once, include cache writes, exclude reused cache and reasoning from rewards',()=>{
  const s=normalizeReport({entries:[{client:'codex',input:100,output:50,cacheRead:900,cacheWrite:0,reasoning:30},{client:'claude',input:10,output:20,cacheRead:500,cacheWrite:60},{client:'codex',input:1,output:2,cacheRead:3,cacheWrite:0}]},'test-device-id-0001')
  assert.equal(s.sources.length,2);assert.equal(s.totals.total,1646);assert.equal(s.totals.eligible,243)
  assert(!JSON.stringify(s).includes('reasoning'))
})
test('reject invalid numbers and unknown formats; estimated transcripts are display-only',()=>{
  assert.throws(()=>normalizeReport({entries:[{client:'codex',input:-1}]},'device'))
  assert.throws(()=>normalizeReport({entries:[{client:'codex',input:0.5}]},'device'))
  assert.throws(()=>normalizeReport({entries:[{client:'unknown',input:1}]},'device'))
  assert.throws(()=>normalizeReport({entries:[{client:'codex',input:Number.MAX_SAFE_INTEGER,output:1}]},'device'))
  const s=normalizeReport({entries:[{client:'freebuff',input:1000,output:500,workspace:'private',model:'private',sessionId:'private'}]},'device')
  assert.equal(s.totals.total,1500);assert.equal(s.totals.eligible,0);assert(!JSON.stringify(s).includes('private'))
})
