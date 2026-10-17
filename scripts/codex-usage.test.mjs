import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, appendFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodexUsageReader, usageSnapshot } from './codex-usage.mjs'

const row = (input, cached, output) => ({ type: 'event_msg', payload: { type: 'token_count', info: {
  total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: output },
} } })
test('exclude cached input; reasoning already belongs to output; ignore unrelated content', () => {
  assert.equal(usageSnapshot(row(2000, 1500, 500)).eligible, 1000)
  assert.equal(usageSnapshot(row(1, 2, 0)), null)
  assert.equal(usageSnapshot(row(-1, 0, 0)), null)
  assert.equal(usageSnapshot({ type: 'response_item', payload: { content: 'private' } }), null)
  assert.equal(usageSnapshot({ type: 'event_msg', payload: { type: 'token_count', info: null } }), null)
})
test('repeat snapshots, partial writes, fresh-reader restart and rollback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'blitz-usage-'))
  const file = join(dir, 'usage.jsonl')
  try {
    await writeFile(file, JSON.stringify(row(10000, 8000, 1000)) + '\n')
    const reader = new CodexUsageReader(file)
    assert.equal((await reader.poll()).eligible, 3000)
    await appendFile(file, JSON.stringify(row(10000, 8000, 1000)) + '\n')
    assert.equal((await reader.poll()).eligible, 3000)
    const next = JSON.stringify(row(12000, 9000, 1500))
    await appendFile(file, next.slice(0, 30))
    assert.equal((await reader.poll()).eligible, 3000)
    await appendFile(file, next.slice(30) + '\n')
    assert.equal((await reader.poll()).eligible, 4500)
    assert.equal((await new CodexUsageReader(file).poll()).eligible, 4500)
    await appendFile(file, JSON.stringify(row(100, 0, 0)) + '\n')
    await assert.rejects(reader.poll(), /累计值回退/)
  } finally { await unlink(file); await rmdir(dir) }
})
