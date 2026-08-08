/** Stable, fail-closed provenance checks for committed E1 baseline fixtures. */
import { execFileSync, spawnSync } from 'node:child_process'
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { canonicalizeJuyitingRuntimeSource } from './juyiting-public-path.mjs'
import { sha256Bytes } from './tmx-structure.mjs'

export const E1_BASELINE_COMMIT = '2424f51f375814f403ca70a9a6e9948728e595b1'
export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const PUBLIC_TREE_PREFIX = 'public/juyiting/'
const ALLOWED_BLOB_MODES = new Set(['100644', '100755'])

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

export function fixtureBaselineCommit(fixture) {
  const baselineCommit = fixture?.baselineCommit ?? fixture?.commit
  if (fixture?.baselineCommit && fixture?.commit && fixture.baselineCommit !== fixture.commit) {
    throw new Error(`Conflicting E1 fixture baseline commits: baselineCommit=${fixture.baselineCommit}, commit=${fixture.commit}`)
  }
  assertLockedBaselineCommit(baselineCommit)
  return baselineCommit
}

export function assertBaselineProvenance(baselineCommit, expectedFiles) {
  assertLockedBaselineCommit(baselineCommit)
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
    const bytes = readBaselineFile(baselineCommit, expected.path)
    const actualSha256 = sha256Bytes(bytes)
    if (actualSha256 !== expected.sha256) {
      throw new Error(`Baseline provenance mismatch for ${expected.path}: expected ${expected.sha256}, got ${actualSha256} at ${baselineCommit}`)
    }
  }
  return { baselineCommit, currentHead: currentHead() }
}

/**
 * Treat the frozen commit's complete public/juyiting tree as the authority.
 * Every baseline entry must be a regular blob, and the current tree must have
 * the exact same files/directories, executable bits, and bytes.
 */
export function assertBaselinePublicTree(publicRoot, baselineCommit = E1_BASELINE_COMMIT) {
  assertBaselineProvenance(baselineCommit, [])
  const baselineEntries = readBaselinePublicTree(baselineCommit)
  const baselineByPath = new Map(baselineEntries.map(entry => [entry.path, entry]))
  const expectedDirectories = baselineDirectories(baselineEntries.map(entry => entry.path))
  const currentEntries = readCurrentPublicTree(publicRoot, expectedDirectories)
  const currentByPath = new Map(currentEntries.map(entry => [entry.path, entry]))

  const missing = [...baselineByPath.keys()].filter(path => !currentByPath.has(path)).sort()
  const extra = [...currentByPath.keys()].filter(path => !baselineByPath.has(path)).sort()
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`Juyiting public tree path mismatch against ${baselineCommit}; missing=[${missing.join(', ')}] extra=[${extra.join(', ')}]`)
  }

  const files = []
  for (const baseline of baselineEntries) {
    const current = currentByPath.get(baseline.path)
    if (current.gitMode !== baseline.gitMode) {
      throw new Error(`Juyiting public tree mode mismatch for ${baseline.path}: baseline ${baseline.gitMode}, current ${current.gitMode}`)
    }
    const baselineBytes = readBaselineFile(baselineCommit, baseline.path)
    const baselineSha256 = sha256Bytes(baselineBytes)
    if (baselineSha256 !== current.sha256) {
      throw new Error(`Baseline provenance mismatch for ${baseline.path}: baseline ${baselineSha256}, current ${current.sha256}`)
    }
    files.push({
      path: baseline.path,
      gitMode: baseline.gitMode,
      baselineBlob: baseline.baselineBlob,
      sizeBytes: current.sizeBytes,
      sha256: current.sha256,
    })
  }

  return {
    baselineCommit,
    pathPrefix: PUBLIC_TREE_PREFIX,
    authority: `git ls-tree -r ${baselineCommit} -- ${PUBLIC_TREE_PREFIX}`,
    acceptedBlobModes: [...ALLOWED_BLOB_MODES],
    exactPathSet: true,
    currentBytesMatchBaseline: true,
    fileCount: files.length,
    files,
  }
}

function assertLockedBaselineCommit(baselineCommit) {
  if (baselineCommit !== E1_BASELINE_COMMIT) {
    throw new Error(`E1 baseline commit must equal locked commit ${E1_BASELINE_COMMIT}; got ${JSON.stringify(baselineCommit)}`)
  }
}

function readBaselinePublicTree(baselineCommit) {
  const output = execFileSync(
    'git',
    ['ls-tree', '-r', '-z', '--full-tree', baselineCommit, '--', PUBLIC_TREE_PREFIX],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  const entries = output.split('\0').filter(Boolean).map(record => {
    const match = /^(\d{6}) ([^ ]+) ([0-9a-f]+)\t([\s\S]+)$/.exec(record)
    if (!match) throw new Error(`Unable to parse baseline git ls-tree record: ${JSON.stringify(record)}`)
    const [, gitMode, type, baselineBlob, path] = match
    if (type !== 'blob' || !ALLOWED_BLOB_MODES.has(gitMode)) {
      throw new Error(`Unsupported baseline public tree entry ${path}: mode=${gitMode} type=${type}; regular blobs only`)
    }
    if (!path.startsWith(PUBLIC_TREE_PREFIX)) {
      throw new Error(`Baseline public tree entry escaped ${PUBLIC_TREE_PREFIX}: ${path}`)
    }
    const canonical = canonicalizeJuyitingRuntimeSource(`/${path.slice('public/'.length)}`)
    if (canonical !== path) throw new Error(`Non-canonical baseline public tree path: ${path}`)
    return { path, gitMode, baselineBlob }
  }).sort((a, b) => a.path.localeCompare(b.path))
  if (entries.length === 0) throw new Error(`Baseline public tree is empty at ${baselineCommit}:${PUBLIC_TREE_PREFIX}`)
  return entries
}

function readCurrentPublicTree(publicRoot, expectedDirectories) {
  const root = resolve(publicRoot)
  let realRoot
  try {
    realRoot = realpathSync(root)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Juyiting public root is missing: ${root}`)
    throw error
  }
  const juyitingRoot = resolve(root, 'juyiting')
  let rootStat
  try {
    rootStat = lstatSync(juyitingRoot)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Juyiting public tree is missing: ${juyitingRoot}`)
    throw error
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`Juyiting public tree root must be a real directory, not a symlink or special file: ${juyitingRoot}`)
  }
  const realJuyitingRoot = realpathSync(juyitingRoot)
  assertInside(realRoot, realJuyitingRoot, 'Juyiting public tree root escapes public root')

  const entries = []
  const walk = (directory, auditDirectory) => {
    if (!expectedDirectories.has(auditDirectory)) {
      throw new Error(`Juyiting public tree contains extra directory: ${auditDirectory}/`)
    }
    for (const name of readdirSync(directory)) {
      const full = resolve(directory, name)
      const auditPath = `${auditDirectory}/${name}`
      const stat = lstatSync(full)
      if (stat.isSymbolicLink()) {
        throw new Error(`Juyiting public tree contains symlink: ${auditPath}`)
      }
      if (stat.isDirectory()) {
        walk(full, auditPath)
        continue
      }
      if (!stat.isFile()) {
        throw new Error(`Juyiting public tree entry is not a regular file: ${auditPath}`)
      }
      const canonical = canonicalizeJuyitingRuntimeSource(`/${auditPath.slice('public/'.length)}`)
      if (canonical !== auditPath) throw new Error(`Non-canonical current public tree path: ${auditPath}`)
      const bytes = readFileSync(full)
      entries.push({
        path: auditPath,
        gitMode: stat.mode & 0o111 ? '100755' : '100644',
        sizeBytes: bytes.length,
        sha256: sha256Bytes(bytes),
      })
    }
  }
  walk(juyitingRoot, 'public/juyiting')
  return entries.sort((a, b) => a.path.localeCompare(b.path))
}

function baselineDirectories(paths) {
  const directories = new Set(['public/juyiting'])
  for (const path of paths) {
    const parts = path.split('/')
    for (let length = 3; length < parts.length; length += 1) {
      directories.add(parts.slice(0, length).join('/'))
    }
  }
  return directories
}

function readBaselineFile(baselineCommit, path) {
  return execFileSync('git', ['show', `${baselineCommit}:${path}`], {
    cwd: repoRoot,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
  })
}

function assertInside(root, candidate, message) {
  const relation = relative(root, candidate)
  if (relation === '..' || relation.startsWith('../') || relation.startsWith('..\\') || isAbsolute(relation)) {
    throw new Error(`${message}: ${candidate}`)
  }
}
