import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Official pricing docs: deepseek-v4-flash now aliases the vision-capable
// DeepSeek-V4.1-Flash-1017. Keep the accepted ID and all user overrides.
// https://api-docs.deepseek.com/quick_start/pricing
export function patchDeepSeekFlashVision(directory) {
  const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-llm-deepseek' || manifest.version !== '0.1.5-rc.2') {
    throw new Error('DeepSeek Flash 能力补丁仅适用于 dsh-llm-deepseek 0.1.5-rc.2')
  }
  const file = path.join(directory, 'lib', 'index.js')
  const before = readFileSync(file, 'utf8')
  const start = before.indexOf('const DEFAULT_MODELS = [')
  const end = before.indexOf('\n];', start)
  if (start < 0 || end < 0) throw new Error('DeepSeek Flash 能力补丁不匹配：找不到默认目录；未修改文件')
  const catalog = before.slice(start, end)
  const pattern = /\{\s*id: "deepseek-v4-flash",[^{}]*\}/g
  const matches = [...catalog.matchAll(pattern)]
  if (matches.length !== 1) throw new Error('DeepSeek Flash 能力补丁不匹配：默认模型不唯一；未修改文件')
  const model = matches[0][0]
  const additions = ',\n\t\tinputModalities: ["text", "image"],\n\t\timagePixelBudget: DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,\n\t\timageMaxBytes: DEFAULT_REQUEST_IMAGE_MAX_BYTES'
  if (model.includes(additions)) return false
  if (/inputModalities|imagePixelBudget|imageMaxBytes/.test(model)
    || !/contextWindow: DEFAULT_CONTEXT_WINDOW\s*\}$/.test(model)) {
    throw new Error('DeepSeek Flash 能力补丁不匹配：默认能力已变化；未修改文件')
  }
  const patched = model.replace('contextWindow: DEFAULT_CONTEXT_WINDOW', 'contextWindow: DEFAULT_CONTEXT_WINDOW' + additions)
  const after = before.slice(0, start) + catalog.replace(model, patched) + before.slice(end)
  writeFileSync(file, after)
  return true
}
