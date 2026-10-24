/**
 * Load smoke test: install this checkout into a throwaway profile and boot it,
 * then assert the plugin actually activated, registered its route and served
 * its API.
 *
 * The other tests run without a harness. This one is the only check that the
 * published entry points (`main`, `./client`, `cordis.patch.yml`) are really
 * loadable by a `dsh` of the version this package claims to support.
 *
 *   node scripts/plugin-smoke.mjs
 *
 * Requires a `dsh` CLI and `pnpm` on PATH; set `DSH_BIN` to point at a specific
 * launcher. The script never touches the caller's harness home.
 *
 * @module scripts/plugin-smoke
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const dsh = process.env.DSH_BIN ?? 'dsh'

/** Fail with one readable line, not a stack trace. */
function fail(message) {
  console.error(`plugin-smoke: ${message}`)
  process.exit(1)
}

/** Run one dsh command synchronously and return its trimmed stdout. */
function run(args, env) {
  const result = spawnSync(dsh, args, { cwd: root, env, encoding: 'utf8' })
  if (result.error !== undefined) fail(`could not run "${dsh}": ${result.error.message}`)
  if (result.status !== 0) {
    fail(`"dsh ${args.join(' ')}" exited ${String(result.status)}\n${result.stderr}\n${result.stdout}`)
  }
  return result.stdout.trim()
}

const home = mkdtempSync(join(tmpdir(), 'dsh-model-queue-smoke-'))
const env = { ...process.env, DSH_HOME: home, NO_COLOR: '1' }
const profile = 'smoke'
let child

try {
  // A base-backed profile has no browser surface, so start from the shipped web
  // template: the point of this check is the real surface a user installs into.
  run(['--profile', profile, '--from-default-profile', 'web', '--dump-config'], env)
  run(['plugin', '--profile', profile, 'add', root], env)

  const composed = run(['--profile', profile, '--dump-config'], env)
  if (!composed.includes(`# == ${pkg.name}`)) fail(`the composed profile does not list ${pkg.name}`)
  if (!/id: model-queue[\s\S]*?name: dsh-model-queue/.test(composed)) fail('the model-queue row is missing from the composed tree')

  // Boot a Web surface on an OS-assigned port and wait for its URL, which
  // carries the launch token the API requires.
  const port = 7411
  child = spawn(dsh, ['--profile', profile, '--host', '127.0.0.1', '--port', String(port), '--no-open'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`no URL within 90s\n${output}`)) }, 90_000)
    const onData = (chunk) => {
      output += String(chunk)
      const match = /(http:\/\/[^\s]+token=[A-Za-z0-9_-]+)/.exec(output)
      if (match === null) return
      clearTimeout(timer)
      resolve(match[1])
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`the host exited ${String(code)}\n${output}`)) })
  })

  const base = new URL(url).origin
  const cookies = new Map()
  const index = await fetch(url, { redirect: 'manual' })
  for (const cookie of index.headers.getSetCookie?.() ?? []) {
    const [pair] = cookie.split(';')
    const [name, value] = pair.split('=')
    if (name !== undefined && value !== undefined) cookies.set(name, value)
  }
  const cookieHeader = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')

  const state = await fetch(`${base}/api/dsh-model-queue/state`, { headers: { cookie: cookieHeader } })
  if (state.status !== 200) fail(`the queue API answered ${String(state.status)}: ${await state.text()}`)
  const view = await state.json()
  if (view.provider !== pkg.name || view.model !== 'queue') fail(`unexpected queue view ${JSON.stringify(view).slice(0, 200)}`)
  if (!Array.isArray(view.entries)) fail('the queue view carries no entries array')

  console.log(`plugin-smoke: ${pkg.name}@${pkg.version} installed, activated, and served its API`)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
} finally {
  if (child !== undefined && child.exitCode === null) child.kill('SIGTERM')
  rmSync(home, { recursive: true, force: true })
}
