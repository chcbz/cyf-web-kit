/** Stable, fail-closed provenance checks for committed E1 baseline fixtures. */
import { createHash } from 'node:crypto'
import { execFileSyncCaptured, spawnSyncCaptured } from './spawn-capture.mjs'
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  canonicalizeJuyitingRuntimeSource,
  readJuyitingPublicFile,
} from './juyiting-public-path.mjs'
import { sha256Bytes } from './tmx-structure.mjs'

export const E1_BASELINE_COMMIT = '2424f51f375814f403ca70a9a6e9948728e595b1'
export const E1_BASELINE_TMX_SHA256 = 'e2b79085d2caf232801f9843bb1cfafa941fb5a7d38e16cede60ecb0ab3e8401'
export const E8B_LIVE_TMX_SHA256 = '291a38cc66ebd60c8577500a5afc18ce5398570fe4c35ca66d9eebe818826a97'
export const CURRENT_LIVE_TMX_SHA256 = '7b304c11fd4a121d92f5fb1430f8073d4d590b3d42eb9b9a18e0e0c9bd22ff53'

// E9B adds six lossless occluder atlas PNGs under this new directory. The E1
// provenance overlay is extended explicitly: E1 baseline files must remain
// byte-identical and hall.tmx remains the only *modified* file; files under
// this directory are the only permitted *additions* (verified against the E9B
// atlas manifest in tests).
export const E9B_OCCLUDER_OVERLAY_DIRECTORY = 'public/juyiting/images/occluders'
export const repoRoot = resolve(
  process.env.JIA_JUYITING_GIT_REPO_ROOT
    ?? fileURLToPath(new URL('../../../', import.meta.url)),
)
const PUBLIC_TREE_PREFIX = 'public/juyiting/'
const ALLOWED_BLOB_MODES = new Set(['100644', '100755'])
const MAX_GIT_BUFFER = 64 * 1024 * 1024

export function currentHead() {
  return gitExec(['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
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
  assertBaselineCommit(baselineCommit)
  const snapshot = readVerifiedBaselineSnapshot(baselineCommit)
  const baselineByPath = new Map(snapshot.files.map(entry => [entry.path, entry]))
  for (const expected of expectedFiles) {
    const baseline = baselineByPath.get(expected.path)
    if (!baseline) {
      throw new Error(`Baseline provenance path is not present in fixed public tree: ${expected.path}`)
    }
    if (baseline.sha256 !== expected.sha256) {
      throw new Error(`Baseline provenance mismatch for ${expected.path}: expected ${expected.sha256}, got ${baseline.sha256} at ${baselineCommit}`)
    }
  }
  return { baselineCommit, currentHead: currentHead() }
}

/**
 * Treat the frozen commit's complete public/juyiting tree as the authority.
 * Every baseline entry must be a verified regular blob, and the current tree
 * must have the exact same files/directories, executable bits, and bytes.
 */
export function assertBaselinePublicTree(publicRoot, baselineCommit = E1_BASELINE_COMMIT) {
  assertBaselineCommit(baselineCommit)
  const baselineSnapshot = readVerifiedBaselineSnapshot(baselineCommit)
  const baselineByPath = new Map(baselineSnapshot.files.map(entry => [entry.path, entry]))
  const expectedDirectories = baselineDirectories(baselineSnapshot.files.map(entry => entry.path))
  const currentSnapshot = readCurrentPublicTree(publicRoot, expectedDirectories)
  const currentByPath = new Map(currentSnapshot.files.map(entry => [entry.path, entry]))

  const missing = [...baselineByPath.keys()].filter(path => !currentByPath.has(path)).sort()
  const extra = [...currentByPath.keys()].filter(path => !baselineByPath.has(path)).sort()
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`Juyiting public tree path mismatch against ${baselineCommit}; missing=[${missing.join(', ')}] extra=[${extra.join(', ')}]`)
  }

  const files = []
  for (const baseline of baselineSnapshot.files) {
    const current = currentByPath.get(baseline.path)
    if (current.gitMode !== baseline.gitMode) {
      throw new Error(`Juyiting public tree mode mismatch for ${baseline.path}: baseline ${baseline.gitMode}, current ${current.gitMode}`)
    }
    if (baseline.sha256 !== current.sha256) {
      throw new Error(`Baseline provenance mismatch for ${baseline.path}: baseline ${baseline.sha256}, current ${current.sha256}`)
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
    authority: `GIT_NO_REPLACE_OBJECTS=1 git ls-tree -r -z --full-tree ${baselineCommit} -- ${PUBLIC_TREE_PREFIX}; blob bytes via git cat-file --batch by object ID`,
    acceptedBlobModes: [...ALLOWED_BLOB_MODES],
    exactPathSet: true,
    currentBytesMatchBaseline: true,
    gitReplaceObjectsDisabled: true,
    baselineObjectFormat: baselineSnapshot.objectFormat,
    fileCount: files.length,
    files,
    bytesByPath: currentSnapshot.bytesByPath,
  }
}

function assertLockedBaselineCommit(baselineCommit) {
  if (baselineCommit !== E1_BASELINE_COMMIT) {
    throw new Error(`E1 baseline commit must equal locked commit ${E1_BASELINE_COMMIT}; got ${JSON.stringify(baselineCommit)}`)
  }
}

function assertBaselineCommit(baselineCommit) {
  assertLockedBaselineCommit(baselineCommit)
  const resolved = gitExec(['rev-parse', '--verify', `${baselineCommit}^{commit}`], { encoding: 'utf8' }).trim()
  if (resolved !== baselineCommit) throw new Error(`Baseline commit did not resolve exactly: ${baselineCommit}`)

  const ancestor = gitSpawn(['merge-base', '--is-ancestor', baselineCommit, 'HEAD'])
  if (ancestor.status !== 0) {
    throw new Error(`E1 baseline commit ${baselineCommit} is not an ancestor of current HEAD ${currentHead()}`)
  }
}

function readVerifiedBaselineSnapshot(baselineCommit) {
  const entries = readBaselinePublicTree(baselineCommit)
  const objectFormat = gitExec(['rev-parse', '--show-object-format'], { encoding: 'utf8' }).trim()
  if (!['sha1', 'sha256'].includes(objectFormat)) {
    throw new Error(`Unsupported Git object format for E1 provenance: ${objectFormat}`)
  }
  const blobs = readAndVerifyBaselineBlobs(entries, objectFormat)
  return {
    objectFormat,
    files: entries.map(entry => {
      const blob = blobs.get(entry.baselineBlob)
      return {
        ...entry,
        baselineSizeBytes: blob.bytes.length,
        sha256: sha256Bytes(blob.bytes),
      }
    }),
  }
}

function readBaselinePublicTree(baselineCommit) {
  const output = gitExec(
    ['ls-tree', '-r', '-z', '--full-tree', baselineCommit, '--', PUBLIC_TREE_PREFIX],
    { encoding: 'utf8' },
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
  if (new Set(entries.map(entry => entry.path)).size !== entries.length) {
    throw new Error(`Baseline public tree contains duplicate path mappings at ${baselineCommit}`)
  }
  return entries
}

function readAndVerifyBaselineBlobs(entries, objectFormat) {
  const uniqueObjectIds = [...new Set(entries.map(entry => entry.baselineBlob))]
  const output = gitExec(['cat-file', '--batch'], {
    encoding: null,
    input: `${uniqueObjectIds.join('\n')}\n`,
  })
  const blobs = new Map()
  let offset = 0
  for (const requestedObjectId of uniqueObjectIds) {
    const headerEnd = output.indexOf(0x0a, offset)
    if (headerEnd < 0) throw new Error(`Truncated git cat-file header for baseline blob ${requestedObjectId}`)
    const header = output.subarray(offset, headerEnd).toString('utf8')
    const match = /^([0-9a-f]+) ([^ ]+) (\d+)$/.exec(header)
    if (!match) throw new Error(`Invalid git cat-file header for baseline blob ${requestedObjectId}: ${header}`)
    const [, returnedObjectId, type, sizeText] = match
    if (returnedObjectId !== requestedObjectId) {
      throw new Error(`Git cat-file returned wrong object ID: requested ${requestedObjectId}, got ${returnedObjectId}`)
    }
    if (type !== 'blob') throw new Error(`Baseline object ${requestedObjectId} is ${type}, expected blob`)
    const size = Number(sizeText)
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Invalid baseline blob size for ${requestedObjectId}: ${sizeText}`)
    const bytesStart = headerEnd + 1
    const bytesEnd = bytesStart + size
    if (bytesEnd >= output.length || output[bytesEnd] !== 0x0a) {
      throw new Error(`Truncated git cat-file body for baseline blob ${requestedObjectId}: expected ${size} bytes`)
    }
    const bytes = output.subarray(bytesStart, bytesEnd)
    const computedObjectId = hashGitBlob(bytes, objectFormat)
    if (computedObjectId !== requestedObjectId) {
      throw new Error(`Baseline blob object hash mismatch: expected ${requestedObjectId}, computed ${computedObjectId}`)
    }
    blobs.set(requestedObjectId, { bytes, type, size })
    offset = bytesEnd + 1
  }
  if (offset !== output.length) throw new Error(`Unexpected trailing bytes from git cat-file --batch: ${output.length - offset}`)
  return blobs
}

function hashGitBlob(bytes, objectFormat) {
  const algorithm = objectFormat === 'sha1' ? 'sha1' : 'sha256'
  return createHash(algorithm)
    .update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes)
    .digest('hex')
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

  const files = []
  const bytesByPath = new Map()
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
      const opened = readJuyitingPublicFile(root, auditPath)
      const bytes = opened.bytes
      bytesByPath.set(auditPath, bytes)
      files.push({
        path: auditPath,
        gitMode: opened.stat.mode & 0o111 ? '100755' : '100644',
        sizeBytes: bytes.length,
        sha256: sha256Bytes(bytes),
      })
    }
  }
  walk(juyitingRoot, 'public/juyiting')
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), bytesByPath }
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

function overlayDirectories(additionalDirectories) {
  const directories = new Set()
  for (const path of additionalDirectories) {
    if (typeof path !== 'string' || !path.startsWith(PUBLIC_TREE_PREFIX) || path.endsWith('/')) {
      throw new Error(`Additional public tree overlay directory must be canonical under ${PUBLIC_TREE_PREFIX}: ${JSON.stringify(path)}`)
    }
    const parts = path.split('/')
    for (let length = 3; length <= parts.length; length += 1) {
      directories.add(parts.slice(0, length).join('/'))
    }
  }
  return directories
}

function isUnderAdditionalDirectory(path, additionalDirectories) {
  return additionalDirectories.some(directory => path === directory || path.startsWith(`${directory}/`))
}

function gitExec(args, options = {}) {
  return execFileSyncCaptured('git', args, {
    cwd: repoRoot,
    maxBuffer: MAX_GIT_BUFFER,
    ...options,
    env: gitEnvironment(),
  })
}

function gitSpawn(args, options = {}) {
  return spawnSyncCaptured('git', args, {
    cwd: repoRoot,
    ...options,
    env: gitEnvironment(),
  })
}

function gitEnvironment() {
  return { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' }
}

/**
 * Read a blob at a specific commit via verified Git (replacement-disabled).
 * Returns the raw bytes.
 */
export function readGitBlobAtCommit(commit, path) {
  const quietTextOptions = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  const resolved = gitExec(['rev-parse', '--verify', `${commit}^{commit}`], quietTextOptions).trim()
  if (resolved !== commit) throw new Error(`Commit did not resolve exactly: ${commit}`)
  const objectId = gitExec(['rev-parse', '--verify', `${resolved}:${path}`], quietTextOptions).trim()
  const output = gitExec(['cat-file', '--batch'], {
    encoding: null,
    input: `${objectId}\n`,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const headerEnd = output.indexOf(0x0a)
  if (headerEnd < 0) throw new Error(`Truncated git cat-file header for blob ${path} at ${commit}`)
  const header = output.subarray(0, headerEnd).toString('utf8')
  const match = /^([0-9a-f]+) ([^ ]+) (\d+)$/.exec(header)
  if (!match) throw new Error(`Invalid git cat-file header for ${path} at ${commit}: ${header}`)
  const [, returnedObjectId, type, sizeText] = match
  if (returnedObjectId !== objectId) throw new Error(`Git cat-file returned wrong object ID for ${path} at ${commit}: requested ${objectId}, got ${returnedObjectId}`)
  if (type !== 'blob') throw new Error(`Object at ${commit}:${path} is ${type}, expected blob`)
  const size = Number(sizeText)
  if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Invalid blob size for ${path} at ${commit}: ${sizeText}`)
  const bytesStart = headerEnd + 1
  const bytesEnd = bytesStart + size
  if (bytesEnd >= output.length || output[bytesEnd] !== 0x0a || bytesEnd + 1 !== output.length) {
    throw new Error(`Truncated or trailing git cat-file body for ${path} at ${commit}`)
  }
  const bytes = output.subarray(bytesStart, bytesEnd)
  const objectFormat = gitExec(['rev-parse', '--show-object-format'], quietTextOptions).trim()
  if (!['sha1', 'sha256'].includes(objectFormat)) {
    throw new Error(`Unsupported Git object format for blob provenance: ${objectFormat}`)
  }
  const computedObjectId = hashGitBlob(bytes, objectFormat)
  if (computedObjectId !== objectId) {
    throw new Error(`Git blob object hash mismatch for ${path} at ${commit}: expected ${objectId}, computed ${computedObjectId}`)
  }
  return bytes
}

/**
 * Materialize the complete public/juyiting tree from the E1 baseline commit
 * into a target directory from replacement-disabled, object-verified blobs.
 * Returns the target directory path for the public tree root.
 * Each blob is verified through the replacement-disabled object store.
 */
export function materializeE1PublicTree(targetDir, baselineCommit = E1_BASELINE_COMMIT) {
  assertBaselineCommit(baselineCommit)
  const snapshot = readVerifiedBaselineSnapshot(baselineCommit)
  mkdirSync(targetDir, { recursive: true })

  const written = []
  for (const entry of snapshot.files) {
    const blobBytes = readGitBlobAtCommit(baselineCommit, entry.path)
    const expectedSha256 = sha256Bytes(blobBytes)
    if (expectedSha256 !== entry.sha256) {
      throw new Error(`E1 materialization: blob sha256 mismatch for ${entry.path}: expected ${entry.sha256}, got ${expectedSha256}`)
    }
    const relPath = entry.path.slice(PUBLIC_TREE_PREFIX.length)
    const targetPath = join(targetDir, relPath)
    const parentDir = join(targetDir, relPath.split('/').slice(0, -1).join('/'))
    mkdirSync(parentDir, { recursive: true })
    writeFileSync(targetPath, blobBytes)
    if (entry.gitMode === '100755') {
      chmodSync(targetPath, 0o755)
    }
    written.push({ path: entry.path, targetPath, sha256: entry.sha256 })
  }
  return { targetDir, baselineCommit, fileCount: written.length, files: written }
}

/**
 * Assert that the current public tree is identical to the E1 baseline,
 * with the sole allowed difference being an exact content replacement of
 * public/juyiting/hall.tmx (E8B migration). Any other difference must fail closed.
 */
export function assertCurrentPublicTreeVsE1(
  publicRoot,
  baselineCommit = E1_BASELINE_COMMIT,
  expectedCurrentTmxSha256 = CURRENT_LIVE_TMX_SHA256,
  options = {},
) {
  assertBaselineCommit(baselineCommit)
  if (!/^[0-9a-f]{64}$/.test(expectedCurrentTmxSha256)) {
    throw new Error(`Expected current hall.tmx SHA-256 must be 64 lowercase hex characters; got ${JSON.stringify(expectedCurrentTmxSha256)}`)
  }
  const additionalDirectories = Array.isArray(options.additionalDirectories) ? options.additionalDirectories : []
  const baselineSnapshot = readVerifiedBaselineSnapshot(baselineCommit)
  const baselineByPath = new Map(baselineSnapshot.files.map(entry => [entry.path, entry]))
  const expectedDirectories = new Set([
    ...baselineDirectories(baselineSnapshot.files.map(entry => entry.path)),
    ...overlayDirectories(additionalDirectories),
  ])
  const currentSnapshot = readCurrentPublicTree(publicRoot, expectedDirectories)
  const currentByPath = new Map(currentSnapshot.files.map(entry => [entry.path, entry]))

  const missing = [...baselineByPath.keys()].filter(path => !currentByPath.has(path)).sort()
  const extra = [...currentByPath.keys()].filter(
    path => !baselineByPath.has(path) && !isUnderAdditionalDirectory(path, additionalDirectories),
  ).sort()
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`Juyiting public tree path mismatch against ${baselineCommit}; missing=[${missing.join(', ')}] extra=[${extra.join(', ')}]`)
  }

  const tmxPath = 'public/juyiting/hall.tmx'
  const baselineTmx = baselineByPath.get(tmxPath)
  const currentTmx = currentByPath.get(tmxPath)
  if (!baselineTmx || baselineTmx.sha256 !== E1_BASELINE_TMX_SHA256) {
    throw new Error(`E1 hall.tmx anchor mismatch: expected ${E1_BASELINE_TMX_SHA256}, got ${baselineTmx?.sha256 ?? '<missing>'}`)
  }
  if (!currentTmx || currentTmx.sha256 !== expectedCurrentTmxSha256) {
    throw new Error(`Current hall.tmx anchor mismatch: expected ${expectedCurrentTmxSha256}, got ${currentTmx?.sha256 ?? '<missing>'}`)
  }

  const diffs = []
  for (const baseline of baselineSnapshot.files) {
    const current = currentByPath.get(baseline.path)
    if (current.gitMode !== baseline.gitMode) {
      throw new Error(`Juyiting public tree mode mismatch for ${baseline.path}: baseline ${baseline.gitMode}, current ${current.gitMode}`)
    }
    if (baseline.sha256 !== current.sha256) {
      if (baseline.path !== tmxPath) {
        throw new Error(`Unauthorised public tree drift for ${baseline.path}: baseline ${baseline.sha256}, current ${current.sha256}. Only ${tmxPath} exact replacement is permitted by the current live overlay.`)
      }
      diffs.push({ path: baseline.path, baselineSha256: baseline.sha256, currentSha256: current.sha256 })
    }
  }
  if (diffs.length !== 1 || diffs[0].path !== tmxPath) {
    throw new Error(`Current public tree must contain exactly one authorised difference (${tmxPath}); got ${JSON.stringify(diffs)}`)
  }

  return {
    baselineCommit,
    allowedDiffs: diffs,
    hallTmxExactReplacementOnly: true,
    currentTmxSha256: currentTmx.sha256,
    baselineTmxSha256: baselineTmx.sha256,
    additionalDirectories: [...additionalDirectories].sort(),
  }
}

function assertInside(root, candidate, message) {
  const relation = relative(root, candidate)
  if (relation === '..' || relation.startsWith('../') || relation.startsWith('..\\') || isAbsolute(relation)) {
    throw new Error(`${message}: ${candidate}`)
  }
}
