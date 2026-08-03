/** Stable provenance checks for committed E1 baseline fixtures. */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { sha256Bytes } from './tmx-structure.mjs'

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

export function currentHead() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
}

export function readJsonIfPresent(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

export function fixtureBaselineCommit(fixture, fallback = currentHead()) {
  const baselineCommit = fixture?.baselineCommit ?? fixture?.commit ?? fallback
  if (!/^[0-9a-f]{40}$/.test(baselineCommit)) {
    throw new Error(`Invalid E1 baseline commit: ${JSON.stringify(baselineCommit)}`)
  }
  return baselineCommit
}

export function assertBaselineProvenance(baselineCommit, expectedFiles) {
  const resolved = execFileSync('git', ['rev-parse', '--verify', `${baselineCommit}^{commit}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim()
  if (resolved !== baselineCommit) throw new Error(`Baseline commit did not resolve exactly: ${baselineCommit}`)

  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', baselineCommit, 'HEAD'], { cwd: repoRoot })
  if (ancestor.status !== 0) {
    throw new Error(`E1 baseline commit ${baselineCommit} is not an ancestor of current HEAD ${currentHead()}`)
  }

  for (const expected of expectedFiles) {
    const bytes = execFileSync('git', ['show', `${baselineCommit}:${expected.path}`], {
      cwd: repoRoot,
      encoding: null,
      maxBuffer: 64 * 1024 * 1024,
    })
    const actualSha256 = sha256Bytes(bytes)
    if (actualSha256 !== expected.sha256) {
      throw new Error(`Baseline provenance mismatch for ${expected.path}: expected ${expected.sha256}, got ${actualSha256} at ${baselineCommit}`)
    }
  }
  return { baselineCommit, currentHead: currentHead() }
}
