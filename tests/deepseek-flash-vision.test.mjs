import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { patchDeepSeekFlashVision } from '../bin/deepseek-flash-vision.mjs'

const hostRequire = createRequire(process.env.DSH_BOOT_MODULE || import.meta.url)
const entry = hostRequire.resolve('@deepseek-ai/dsh-llm-deepseek')
const source = readFileSync(entry, 'utf8')
const manifest = readFileSync(hostRequire.resolve('@deepseek-ai/dsh-llm-deepseek/package.json'), 'utf8')
function fixture(t, text = source) {
  const directory = mkdtempSync(path.join(tmpdir(), 'tavern-deepseek-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  mkdirSync(path.join(directory, 'lib'))
  writeFileSync(path.join(directory, 'package.json'), manifest)
  writeFileSync(path.join(directory, 'lib/index.js'), text)
  return directory
}

test('official Flash alias exposes image capability through the real adapter; Pro and overrides stay unchanged', async t => {
  const directory = fixture(t)
  patchDeepSeekFlashVision(directory)
  const patched = readFileSync(path.join(directory, 'lib/index.js'), 'utf8')
  assert.equal(patchDeepSeekFlashVision(directory), false)
  const require = createRequire(entry)
  const moduleSource = patched.replace(/\bfrom "([^"]+)"/g, (_, name) => 'from ' + JSON.stringify(
    name.startsWith('node:') ? name : pathToFileURL(require.resolve(name)).href))
  const runtime = await import('data:text/javascript;base64,' + Buffer.from(moduleSource).toString('base64'))
  const options = runtime.resolveAdapterOptions({}, new Map())
  const adapter = new runtime.DeepSeekAdapter({ options: () => options, resolveFiles: () => ({}) })
  const models = await adapter.listModels('deepseek-official')
  assert.deepEqual(models.find(model => model.id === 'deepseek-v4-flash').inputModalities, ['text', 'image'])
  assert.deepEqual((await adapter.resolveModel('deepseek-official', 'deepseek-v4-flash')).inputModalities, ['text', 'image'])
  assert.deepEqual(models.find(model => model.id === 'deepseek-v4-pro').inputModalities, ['text'])
  const flash = options.models.find(model => model.id === 'deepseek-flash')
  const alias = options.models.find(model => model.id === 'deepseek-v4-flash')
  assert.equal(alias.imagePixelBudget, flash.imagePixelBudget)
  assert.equal(alias.imageMaxBytes, flash.imageMaxBytes)
  const custom = runtime.resolveAdapterOptions({ models: [{ id: 'deepseek-v4-flash', inputModalities: ['text'] }] }, new Map())
  assert.deepEqual(custom.models[0].inputModalities, ['text'])
})

test('unexpected runtime version or catalog fails without modifying the file', t => {
  const directory = fixture(t, source.replace('const DEFAULT_MODELS = [', 'const RENAMED_MODELS = ['))
  const file = path.join(directory, 'lib/index.js')
  const before = readFileSync(file, 'utf8')
  assert.throws(() => patchDeepSeekFlashVision(directory), /找不到默认目录/)
  assert.equal(readFileSync(file, 'utf8'), before)
  writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-llm-deepseek', version: 'future' }))
  assert.throws(() => patchDeepSeekFlashVision(directory), /仅适用于/)
  assert.equal(readFileSync(file, 'utf8'), before)
})
