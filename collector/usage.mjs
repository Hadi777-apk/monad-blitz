import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
export const ENGINE_VERSION = '4.19.1'
export const SUPPORTED = ['opencode','claude','codex','cursor','gemini','amp','droid','openclaw','pi','kimi','qwen','roocode','kilocode','mux','kilo','crush','hermes','copilot','goose','codebuff','antigravity','zed','kiro','trae','warp','cline','9router','gjc','grok','jcode','commandcode','micode','antigravity-cli','junie','zcode','opencodereview','codebuddy','workbuddy','devin-cli','devin-desktop','senpi','augment','kimchi','reasonix','prime-agent','freebuff','cherrystudio','dsh','mcode','fx','omp','lmstudio','unsloth','hindsight','micode-desktop','muse','antigravity-extension','synthetic']
const labels = { claude:'Claude Code / Desktop',codex:'Codex',cursor:'Cursor',gemini:'Gemini CLI',opencode:'OpenCode',copilot:'GitHub Copilot',pi:'Pi',workbuddy:'WorkBuddy',cherrystudio:'Cherry Studio',lmstudio:'LM Studio',openclaw:'OpenClaw',roocode:'Roo Code',kilocode:'Kilo Code',amp:'Amp',droid:'Factory Droid' }
const fields = ['input','output','cacheRead','cacheWrite']
const count = n => { if (!Number.isSafeInteger(n) || n < 0) throw new Error('统计字段无效或超出安全整数范围'); return n }

export function normalizeReport(report, machineId, collectedAt = new Date().toISOString()) {
  if (!report || !Array.isArray(report.entries)) throw new Error('Tokscale 统计格式无效')
  const grouped = new Map()
  for (const row of report.entries) {
    if (!SUPPORTED.includes(row.client)) throw new Error('出现未知来源，请更新采集器后核对')
    const source = grouped.get(row.client) ?? { id:row.client,label:labels[row.client]??row.client,input:0,output:0,cacheRead:0,cacheWrite:0,quality:row.client==='freebuff'?'estimated':'recorded' }
    for (const key of fields) source[key] = count(source[key] + count(row[key] ?? 0))
    grouped.set(row.client,source)
  }
  const sources = [...grouped.values()].sort((a,b)=>a.id.localeCompare(b.id)).map(s=>({
    ...s,total:count(s.input+s.output+s.cacheRead+s.cacheWrite),
    // Normalized Tokscale input excludes both cache categories. Cache writes are new input;
    // cache reads are reused input. Reasoning is already included in output.
    eligible:s.quality==='recorded'?count(s.input+s.output+s.cacheWrite):0,
  }))
  const totals = { input:0,output:0,cacheRead:0,cacheWrite:0,total:0,eligible:0 }
  for (const s of sources) for (const key of Object.keys(totals)) totals[key] = count(totals[key]+s[key])
  return { schema:'blitz-ai-usage/v1',machineId,collectedAt,engine:{name:'Tokscale',version:ENGINE_VERSION,repository:'https://github.com/junhoyeo/tokscale'},totals,sources,
    coverage:{supported:SUPPORTED.length,found:sources.length,estimated:sources.filter(s=>s.quality==='estimated').length,missing:'没有记录的工具不等于用量为零；网页版或未提供统计的客户端无法完整读取。'} }
}

export async function scanUsage(machineId, stateDir) {
  const platform = process.platform === 'win32' ? 'cli-win32-x64-msvc' : process.platform === 'darwin' ? `cli-darwin-${process.arch}` : `cli-linux-${process.arch==='x64'?'x64':'arm64'}-gnu`
  const executable = process.platform==='win32'?'tokscale.exe':'tokscale'
  const portable = resolve(here,'bin',executable)
  const binary = existsSync(portable)?portable:resolve(here,'node_modules/@tokscale',platform,'bin',executable)
  const { stdout } = await run(binary,['models','--json','--home',homedir(),'--group-by','client,model','--no-spinner'],{
    windowsHide:true,timeout:120000,maxBuffer:32*1024*1024,
    // Explicit --home disables implicit Cursor/Amp cloud sync in pinned Tokscale 4.19.1.
    env:{...process.env,TOKSCALE_CONFIG_DIR:resolve(stateDir,'tokscale'),TOKSCALE_RECOVERY_DISABLE:'1'},
  })
  // Do not expose model names, project paths, session identifiers, costs or raw warnings.
  return normalizeReport(JSON.parse(stdout),machineId)
}
