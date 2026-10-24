/**
 * Build the shipped `lib/` artifacts.
 *
 * `lib/` is committed on purpose: a Git install, an npm release and an npm
 * tarball must all supply loadable code without a build step, because pnpm
 * blocks build scripts for a git-hosted dependency. This script is therefore an
 * explicit `compile` command, never a lifecycle hook.
 *
 *   node scripts/build.mjs           write lib/
 *   node scripts/build.mjs --check   rebuild into .tmp/ and compare with lib/
 *
 * @module scripts/build
 */
import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv.includes('--check')
const outDir = check ? join(root, '.tmp', 'lib-check') : join(root, 'lib')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/**
 * Every dependency the host supplies; bundling them would duplicate the host.
 *
 * `@deepseek-ai/*` must stay external: the plugin's `LlmAdapter` subclass has to
 * be the host's own class identity for `registerAdapter()` to accept it, and the
 * same holds for every error class it throws.
 */
const external = ['@deepseek-ai/*']

/**
 * Browser bundle externals: the shell's shared module table plus whatever the
 * module loader resolves for a plugin.
 *
 * React must be external. The shell seeds exactly one React instance; a plugin
 * that bundles its own second copy crashes every hook call in the page with
 * "Invalid hook call ... more than one copy of React". The loader hands the
 * factory a `require` that answers these specifiers from that one instance.
 */
const clientExternal = [
  '@deepseek-ai/*',
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
]

/**
 * Recursively list files under a directory, relative and sorted.
 * @param dir - absolute directory.
 * @returns relative POSIX paths.
 */
function listFiles(dir) {
  const out = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) out.push(relative(dir, full).split('\\').join('/'))
    }
  }
  walk(dir)
  return out.sort()
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

await build({
  entryPoints: [join(root, 'src', 'index.ts')],
  outfile: join(outDir, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external,
  sourcemap: false,
  logLevel: 'warning',
})

const clientEntry = join(root, 'src', 'client', 'index.tsx')
if (existsSync(clientEntry)) {
  // The shell injects client plugins as plain scripts and supplies its own
  // `require`, so this bundle is CJS wrapped in the module-loader envelope.
  // An ESM client fails the whole web boot with "Cannot use import statement
  // outside a module".
  const cjs = await build({
    entryPoints: [clientEntry],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    external: clientExternal,
    sourcemap: false,
    logLevel: 'warning',
    write: false,
  })
  const body = cjs.outputFiles[0]?.text
  if (body === undefined) throw new Error('client bundle produced no output')
  writeFileSync(join(outDir, 'client.js'), wrapClientModule(pkg.name, body))
}

/**
 * Wrap a CommonJS client bundle in the DSH client module-loader envelope.
 * @param id - module id the loader registers, matching the package name.
 * @param cjs - CommonJS source produced by esbuild.
 * @returns a self-contained script that registers the module.
 */
function wrapClientModule(id, cjs) {
  return `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {\n`
    + 'var module = { exports: {} }; var exports = module.exports;\n'
    + `${cjs}\n`
    + 'return module.exports; } });\n'
}

writeFileSync(
  join(outDir, 'build-info.json'),
  `${JSON.stringify({ name: pkg.name, version: pkg.version, format: 'esm', entry: 'src/index.ts' }, null, 2)}\n`,
)

if (!check) {
  console.log(`built ${pkg.name}@${pkg.version} -> lib/`)
  process.exit(0)
}

/** Compare a freshly built tree against the committed one. */
const shipped = join(root, 'lib')
if (!existsSync(shipped)) {
  console.error('check:dist: lib/ is missing; run `npm run compile` and commit it')
  process.exit(1)
}
const fresh = listFiles(outDir)
const committed = listFiles(shipped)
const problems = []
for (const file of fresh) {
  if (!committed.includes(file)) problems.push(`missing in lib/: ${file}`)
  else if (!readFileSync(join(outDir, file)).equals(readFileSync(join(shipped, file)))) {
    problems.push(`differs from source: ${file}`)
  }
}
for (const file of committed) {
  if (!fresh.includes(file)) problems.push(`stale in lib/: ${file}`)
}
rmSync(join(root, '.tmp'), { recursive: true, force: true })
if (problems.length > 0) {
  console.error(`check:dist: lib/ is out of date (${statSync(shipped).size} bytes root)\n${problems.join('\n')}`)
  process.exit(1)
}
console.log('check:dist: lib/ matches source')
