/**
 * Strict canonicalization and descriptor-bound reads for Juyiting public assets.
 *
 * The current asset contract uses only ASCII RFC 3986 unreserved characters
 * inside path segments. Percent escapes are deliberately unsupported: rejecting
 * them avoids browser/server decode disagreements, encoded dot segments, and
 * encoded separators. Every accepted source has exactly one audit path.
 */

import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

const AUDIT_ORIGIN = 'https://juyiting-audit.invalid'
const RUNTIME_PREFIX = '/juyiting/'
const PUBLIC_PREFIX = 'public/juyiting/'
const SAFE_SEGMENT = /^[A-Za-z0-9._~-]+$/
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/
const VALID_PERCENT_ESCAPE = /^[0-9A-Fa-f]{2}$/
const PROC_FD_ROOT = '/proc/self/fd'

const defaultPublicFileOperations = {
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
}

export function canonicalizeJuyitingRuntimeSource(source) {
  return canonicalize(source, 'runtime')
}

export function canonicalizeJuyitingTmxSource(source) {
  return canonicalize(source, 'tmx')
}

/**
 * Opens with O_NOFOLLOW, validates and resolves the opened descriptor, then
 * reads bytes from that same descriptor. No security decision is followed by a
 * second pathname read.
 */
export function readJuyitingPublicFile(publicRoot, canonicalPublicPath, operationOverrides = {}) {
  return inspectOpenedJuyitingFile(publicRoot, canonicalPublicPath, true, operationOverrides)
}

/** Boundary-only compatibility helper. Callers that need bytes must use readJuyitingPublicFile(). */
export function resolveJuyitingPublicFile(publicRoot, canonicalPublicPath, operationOverrides = {}) {
  return inspectOpenedJuyitingFile(publicRoot, canonicalPublicPath, false, operationOverrides).realPath
}

function inspectOpenedJuyitingFile(publicRoot, canonicalPublicPath, includeBytes, operationOverrides) {
  validateCanonicalPublicPath(canonicalPublicPath)
  if (constants.O_NOFOLLOW === undefined) {
    throw new Error('Descriptor-bound Juyiting reads require fs.constants.O_NOFOLLOW on this host')
  }
  const operations = { ...defaultPublicFileOperations, ...operationOverrides }
  const publicPath = resolve(publicRoot)
  const juyitingRoot = resolve(publicPath, 'juyiting')
  let realJuyitingRoot
  try {
    realJuyitingRoot = operations.realpathSync(juyitingRoot)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Juyiting public tree is missing: ${juyitingRoot}`)
    throw error
  }

  const candidate = resolve(juyitingRoot, canonicalPublicPath.slice(PUBLIC_PREFIX.length))
  assertInside(juyitingRoot, candidate, `Juyiting public path escapes public/juyiting root: ${canonicalPublicPath}`)

  let descriptor
  let result
  let primaryError
  try {
    descriptor = operations.openSync(candidate, constants.O_RDONLY | constants.O_NOFOLLOW)
    const stat = operations.fstatSync(descriptor)
    if (!stat.isFile()) throw new Error(`Juyiting public path is not a regular file: ${canonicalPublicPath}`)
    const realPath = operations.realpathSync(`${PROC_FD_ROOT}/${descriptor}`)
    assertInside(
      realJuyitingRoot,
      realPath,
      `Juyiting public file descriptor resolves outside real public/juyiting root: ${canonicalPublicPath}`,
    )
    const bytes = includeBytes ? operations.readFileSync(descriptor) : undefined
    if (bytes && bytes.length !== stat.size) {
      throw new Error(`Juyiting public file changed size during descriptor-bound read: ${canonicalPublicPath}; fstat=${stat.size}, read=${bytes.length}`)
    }
    result = { realPath, stat, bytes }
  } catch (error) {
    primaryError = normalizePublicReadError(error, canonicalPublicPath)
  }

  let closeError
  if (descriptor !== undefined) {
    try { operations.closeSync(descriptor) } catch (error) { closeError = asError(error) }
  }
  if (primaryError && closeError) {
    throw new AggregateError(
      [primaryError, closeError],
      `Juyiting descriptor-bound read failed: ${primaryError.message}; close also failed: ${closeError.message}`,
    )
  }
  if (primaryError) throw primaryError
  if (closeError) throw closeError
  return result
}

function validateCanonicalPublicPath(canonicalPublicPath) {
  if (typeof canonicalPublicPath !== 'string' || !canonicalPublicPath.startsWith(PUBLIC_PREFIX)) {
    throw new Error(`Expected canonical Juyiting public path, got ${JSON.stringify(canonicalPublicPath)}`)
  }
  const recanonicalized = canonicalizeJuyitingRuntimeSource(`/${canonicalPublicPath.slice('public/'.length)}`)
  if (recanonicalized !== canonicalPublicPath) {
    throw new Error(`Non-canonical Juyiting public path: ${canonicalPublicPath}`)
  }
}

function normalizePublicReadError(error, canonicalPublicPath) {
  if (error?.code === 'ENOENT') return new Error(`Juyiting public file is missing: ${canonicalPublicPath}`)
  if (error?.code === 'ELOOP') return new Error(`Juyiting public file must not be a symlink: ${canonicalPublicPath}`)
  return asError(error)
}

function assertInside(root, candidate, message) {
  const relation = relative(root, candidate)
  if (relation === '' || relation === '..' || relation.startsWith('../') || relation.startsWith('..\\') || isAbsolute(relation)) {
    throw new Error(`${message} -> ${candidate}`)
  }
}

function asError(error) {
  return error instanceof Error ? error : new Error(String(error))
}

function canonicalize(source, kind) {
  if (typeof source !== 'string' || source.length === 0) {
    throw new Error(`Juyiting ${kind} source must be a non-empty string`)
  }
  if (source !== source.trim()) throw new Error(`Juyiting ${kind} source contains surrounding whitespace: ${JSON.stringify(source)}`)
  if (CONTROL_CHARACTER.test(source)) throw new Error(`Juyiting ${kind} source contains a control character`)
  if (source.includes('\\')) throw new Error(`Juyiting ${kind} source contains a backslash: ${source}`)
  if (source.includes('?') || source.includes('#')) throw new Error(`Juyiting ${kind} source must not contain query or hash: ${source}`)
  rejectPercentEncoding(source, kind)

  let pathname
  let parsed
  if (kind === 'runtime') {
    if (!source.startsWith(RUNTIME_PREFIX)) {
      throw new Error(`Juyiting runtime source must be an absolute ${RUNTIME_PREFIX} path without origin: ${source}`)
    }
    validateSegments(source.slice(1), kind, source)
    parsed = new URL(source, `${AUDIT_ORIGIN}/`)
    pathname = source
  } else if (kind === 'tmx') {
    if (source.startsWith('/') || source.startsWith('//')) {
      throw new Error(`Juyiting TMX source must be relative to /juyiting/: ${source}`)
    }
    validateSegments(source, kind, source)
    parsed = new URL(source, `${AUDIT_ORIGIN}${RUNTIME_PREFIX}`)
    pathname = `${RUNTIME_PREFIX}${source}`
  } else {
    throw new Error(`Unknown Juyiting source kind: ${kind}`)
  }

  if (parsed.origin !== AUDIT_ORIGIN || parsed.username || parsed.password) {
    throw new Error(`Juyiting ${kind} source must not contain scheme, origin, credentials, or host: ${source}`)
  }
  if (parsed.search || parsed.hash) throw new Error(`Juyiting ${kind} source must not contain query or hash: ${source}`)
  if (parsed.pathname !== pathname) {
    throw new Error(`Juyiting ${kind} source changes under WHATWG URL normalization: ${source} -> ${parsed.pathname}`)
  }
  if (!parsed.pathname.startsWith(RUNTIME_PREFIX) || parsed.pathname === RUNTIME_PREFIX) {
    throw new Error(`Juyiting ${kind} source escapes or names the /juyiting/ directory: ${source}`)
  }
  return `public${parsed.pathname}`
}

function validateSegments(path, kind, source) {
  const segments = path.split('/')
  if (segments.some(segment => segment.length === 0)) {
    throw new Error(`Juyiting ${kind} source contains an empty path segment: ${source}`)
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new Error(`Juyiting ${kind} source contains a dot segment: ${source}`)
    }
    if (!SAFE_SEGMENT.test(segment)) {
      throw new Error(`Juyiting ${kind} source contains unsupported path characters: ${source}`)
    }
  }
}

function rejectPercentEncoding(source, kind) {
  let percentIndex = source.indexOf('%')
  if (percentIndex < 0) return
  while (percentIndex >= 0) {
    if (!VALID_PERCENT_ESCAPE.test(source.slice(percentIndex + 1, percentIndex + 3))) {
      throw new Error(`Juyiting ${kind} source contains invalid percent encoding: ${source}`)
    }
    percentIndex = source.indexOf('%', percentIndex + 1)
  }
  throw new Error(`Juyiting ${kind} source contains unsupported percent encoding: ${source}`)
}
