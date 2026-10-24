/**
 * Generate `dist/plugin-index.json`, the plugin-market entry describing this
 * repository's bundle.
 *
 * The index is derived from the manifests rather than hand-written, so the
 * install source it advertises is exactly what this commit offers: the
 * repository URL, the commit that produced it, and the package version.
 *
 *   node scripts/plugin-index.mjs
 *
 * @module scripts/plugin-index
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const naming = JSON.parse(readFileSync(join(root, 'dsh-plugin.naming.json'), 'utf8'))

/** Resolve the commit this checkout is at, or the empty string outside Git. */
function commitOf() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

const repository = pkg.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '') ?? ''
const commit = commitOf()

/** One plugin entry in the market format (format 1). */
const entry = {
  name: pkg.name,
  title: 'Model Queue',
  description: pkg.description,
  author: naming.plugin.namespace,
  homepage: pkg.homepage,
  repository: { url: repository },
  versions: [
    {
      version: pkg.version,
      publishTimestamp: Math.floor(Date.now() / 1000),
      source: commit === ''
        ? { type: 'git', url: repository }
        : { type: 'git', url: repository, commit },
      engines: pkg.engines,
    },
  ],
}

const index = {
  format: 1,
  title: 'Model Queue',
  plugins: [entry],
}

mkdirSync(join(root, 'dist'), { recursive: true })
writeFileSync(join(root, 'dist', 'plugin-index.json'), `${JSON.stringify(index, null, 2)}\n`)
console.log(`wrote dist/plugin-index.json for ${pkg.name}@${pkg.version}${commit === '' ? '' : ` at ${commit.slice(0, 12)}`}`)
