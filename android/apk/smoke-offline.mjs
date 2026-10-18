import { spawn, execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const dsh = execFileSync('/bin/bash', ['-c', 'command -v dsh'], { encoding: 'utf8' }).trim()
const child = spawn(process.execPath, ['--expose-internals', dsh, '--profile', 'tavern',
  '--host', '127.0.0.1', '--port', '3088', '--no-open'], {
  env: { ...process.env, HOME: '/root', DSH_HOME: '/root/.dsh',
    DSH_TAVERN_RUNTIME_HOST: 'android', DSH_TAVERN_ANDROID_STANDALONE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stdout.on('data', data => { output += data })
child.stderr.on('data', data => { output += data })
const exited = new Promise(resolve => child.once('exit', resolve))
try {
  let ready = false
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`Gateway exited: ${output}`)
    const url = output.match(/http:\/\/127\.0\.0\.1:3088\/[^\s]*token=[^\s]+/)?.[0]
    if (url) {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) }).catch(() => null)
      if (response?.ok && (await response.text()).includes('<html')) { ready = true; break }
    }
    await delay(1000)
  }
  if (!ready) throw new Error(`Offline HTTP startup timed out: ${output}`)
  console.log('Offline Tavern Gateway HTTP smoke passed')
} finally {
  child.kill('SIGTERM')
  await Promise.race([exited, delay(5000)])
  if (child.exitCode === null) child.kill('SIGKILL')
}
