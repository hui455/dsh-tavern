// Real isolated DSH + native Session forks + Chromium; only model output is fixed.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, cp, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const runtime = process.env.TAVERN_E2E_RUNTIME || join(homedir(), '.dsh-tavern/runtime')
const modules = await access(join(runtime, 'node_modules/@deepseek-ai/dsh')).then(() => join(runtime, 'node_modules'))
  .catch(() => join(runtime, 'lib/node_modules'))
const outputBase = join(source, 'output/card-fork-e2e')
await mkdir(outputBase, { recursive: true })
const output = await mkdtemp(join(outputBase, 'run-'))
const root = join(output, 'home'), profile = join(root, 'profiles/tavern'), data = join(root, 'profile-data/tavern/data')
await mkdir(join(profile, 'node_modules'), { recursive: true })
await mkdir(data, { recursive: true })
const link = (target, path) => symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir')
const report = { scope: 'isolated DSH, native sessions, real RPC and disk persistence, fixed provider output', checks: [] }
let log = '', browser, page, child
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
try {
  for (const [name, target] of Object.entries({
    'dsh-tavern-plugin': join(source, 'tavern-plugin'),
    'dsh-tavern-remote': join(source, 'tavern-plugin/packages/dsh-tavern-remote'),
    'dsh-web-mobile': join(source, 'node_modules/dsh-web-mobile')
  })) await link(target, join(profile, 'node_modules', name))
  await mkdir(join(profile, 'node_modules/@deepseek-ai'), { recursive: true })
  for (const name of await readdir(join(modules, '@deepseek-ai'))) {
    await link(join(modules, '@deepseek-ai', name), join(profile, 'node_modules/@deepseek-ai', name))
  }
  await cp(join(source, 'node_modules/dsh-better-sidebar'), join(profile, 'node_modules/dsh-better-sidebar'), { recursive: true, dereference: true })
  for (const name of await readdir(join(source, 'node_modules'))) {
    if (name.startsWith('.') || ['@deepseek-ai', 'dsh-tavern-plugin', 'dsh-tavern-remote', 'dsh-web-mobile', 'dsh-better-sidebar'].includes(name)) continue
    await link(join(source, 'node_modules', name), join(profile, 'node_modules', name))
  }
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'tavern-card-fork-e2e', private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-web-mobile', 'dsh-better-sidebar', 'dsh-tavern-plugin', 'dsh-tavern-remote'] } } }))
  const modelPath = join(output, 'model.mjs')
  await writeFile(modelPath, `import {pathToFileURL} from 'node:url';
const {LlmAdapter}=await import(pathToFileURL(${JSON.stringify(join(modules, '@deepseek-ai/dsh-llm/lib/index.js'))}));
export const inject=['llm'];
export function apply(ctx){class Model extends LlmAdapter {
async resolveModel(provider,id){return {provider,id,name:'Card fork test',context:{contextWindow:64000}}}
async *stream(input){const text=JSON.stringify(input.messages);const label=text.includes('FORK_CONTINUE')?'分支继续完成':text.includes('ROUND_TWO')?'第二轮设定完成':'第一轮设定完成';
yield {type:'block-start',index:0,blockType:'text'};yield {type:'block-end',index:0,block:{type:'text',text:label}};yield {type:'finish',reason:{kind:'stop'}};}}
ctx.get('llm').registerAdapter(['card-fork-e2e'],new Model());}`)
  await writeFile(join(profile, 'cordis.patch.yml'), `- id: agent-default-model\n  config:\n    provider: card-fork-e2e\n    model: fixed\n- insert:\n    - id: card-fork-e2e-model\n      name: ${JSON.stringify(modelPath)}\n`)
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['path', 'systemroot', 'home', 'temp', 'tmp', 'tmpdir', 'lang'].includes(key.toLowerCase())))
  Object.assign(env, { DSH_HOME: root, DSH_CWD: root })
  // Isolated profile has no copied credentials or configured live providers.
  child = spawn(process.execPath, [join(modules, '@deepseek-ai/dsh/lib/bin.js'), '--profile', 'tavern', '--host', '127.0.0.1', '--port', '0', '--no-open'],
    { cwd: source, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  child.stdout.on('data', chunk => { log += chunk }); child.stderr.on('data', chunk => { log += chunk })
  console.log('Isolated test server starting, PID ' + child.pid)
  let url
  for (const deadline = Date.now() + 120000; Date.now() < deadline;) {
    url = log.match(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+[^\s\u001b]*/)?.[0]
    if (url) break
    if (child.exitCode !== null) throw Error('DSH exited ' + child.exitCode)
    await pause(100)
  }
  assert.ok(url, 'DSH startup timeout')
  console.log('Isolated test server ready')
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  context.setDefaultTimeout(30000)
  page = await context.newPage()
  let baselineClient = false
  await page.route('**/plugins/**', async route => {
    if (!route.request().url().includes('client.js')) return route.continue()
    const response = await route.fetch()
    const current = await response.text()
    const body = baselineClient ? current.replace(
      'const canFork = view && (isPlayMode(view.mode) || view.mode === "card") && forkTurn > 0;',
      'const canFork = view && isPlayMode(view.mode) && forkTurn > 0;') : current
    await route.fulfill({ response, body })
  })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  await page.getByRole('button', { name: /^(Continue|继续)$/ }).click()
  await page.getByRole('button', { name: '卡片', exact: true }).click()
  await page.getByRole('button', { name: /空白开始/ }).click()
  const store = createChatJournalStore({ dataRoot: data })
  async function chats() { return Promise.all((await readdir(join(data, 'chats'))).filter(id => !id.includes('.')).map(id => store.read(id))) }
  async function waitForChat(predicate) {
    for (const deadline = Date.now() + 30000; Date.now() < deadline;) {
      const chat = (await chats()).find(predicate)
      if (chat) return chat
      await pause(150)
    }
    throw Error('Timed out waiting for committed card chat')
  }
  async function send(text, reply) {
    const composer = page.getByRole('textbox', { name: /发消息|Message|描述/ })
    await composer.fill(text); await composer.press('Enter')
    await page.getByText(reply, { exact: true }).filter({ visible: true }).last().waitFor()
  }
  await send('ROUND_ONE 帮我整理人物设定。', '第一轮设定完成')
  let original = await waitForChat(chat => chat.mode === 'card' && chat.messages?.length === 2)
  await send('ROUND_TWO 保留第一轮，讨论另一种开场。', '第二轮设定完成')
  original = await waitForChat(chat => chat.id === original.id && chat.messages?.length === 4)
  await page.locator('.dsh-tavern-message-fork').last().waitFor({ state: 'attached' })
  report.checks.push('two actual card turns committed with native turn ids')
  async function showConversation() {
    await page.getByText('第二轮设定完成', { exact: true }).last().waitFor({ state: 'attached' })
    await page.waitForTimeout(250)
    const collapse = page.getByRole('button', { name: /^(Collapse right sidebar|收起右侧(?:边)?栏)$/ }).filter({ visible: true })
    if (await collapse.count()) await collapse.first().click()
  }

  // Restore the actual pre-change renderer gate for the before capture;
  // same saved conversation, viewport and host theme for both real renders.
  for (const scheme of ['light', 'dark']) for (const [device, viewport] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } })) {
    await page.setViewportSize(viewport)
    await page.emulateMedia({ colorScheme: scheme })
    await showConversation()
    await page.getByText('第二轮设定完成', { exact: true }).filter({ visible: true }).last().hover()
    await page.screenshot({ path: join(output, `after-${device}-${scheme}.png`) })
    baselineClient = true
    await page.reload()
    await showConversation()
    await page.getByText('第二轮设定完成', { exact: true }).filter({ visible: true }).last().hover()
    assert.equal(await page.locator('.dsh-tavern-message-fork').count(), 0)
    await page.screenshot({ path: join(output, `before-${device}-${scheme}.png`) })
    baselineClient = false
    await page.reload()
    await showConversation()
    await page.locator('.dsh-tavern-message-fork').last().waitFor({ state: 'attached' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, device + ' must not overflow horizontally')
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await page.emulateMedia({ colorScheme: 'light' })
  await page.locator('.dsh-tavern-message-fork').first().dispatchEvent('click')
  const fork = await waitForChat(chat => chat.forkedFrom?.chatId === original.id)
  assert.equal(fork.mode, 'card'); assert.equal(fork.messages.length, 2)
  assert.deepEqual(fork.workspace.draft, original.workspace.draft)
  assert.equal(fork.messages.at(-1).text, '第一轮设定完成')
  report.checks.push('click historical reply forks native history and binds a new card workbench')
  // Persistence precedes the host's async session switch. Send only after the
  // original second reply has left the actual conversation surface.
  await page.getByText('第二轮设定完成', { exact: true }).waitFor({ state: 'hidden' })
  await send('FORK_CONTINUE 继续分支设定。', '分支继续完成')
  const continued = await waitForChat(chat => chat.id === fork.id && chat.messages.length === 4)
  assert.equal((await store.read(original.id)).messages.length, 4)
  assert.notEqual(continued.timeline.branchId, original.timeline.branchId)
  await page.reload()
  await page.getByText('分支继续完成', { exact: true }).filter({ visible: true }).last().waitFor()
  assert.equal(await page.getByText('第二轮设定完成', { exact: true }).count(), 0)
  report.checks.push('branch continues after reload; original later reply is absent and original chat is unchanged')
  await page.locator('.dsh-tavern-message-fork').first().dispatchEvent('click')
  const nested = await waitForChat(chat => chat.forkedFrom?.chatId === fork.id)
  assert.equal(nested.messages.length, 2)
  report.checks.push('inherited history can fork again through its parent snapshot')
  assert.deepEqual(errors, [])
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'; report.error = error.stack; process.exitCode = 1
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  if (page) await writeFile(join(output, 'failure.txt'), await page.locator('body').innerText().catch(() => ''))
} finally {
  await browser?.close()
  if (child && child.exitCode === null) { child.kill(); await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(3000)]) }
  await writeFile(join(output, 'server.log'), log.replace(/token=[^\s&]+/g, 'token=REDACTED'))
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, output }, null, 2))
}
