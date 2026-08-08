/**
 * Strict canonicalization for browser-visible Juyiting public asset paths.
 *
 * The current asset contract uses only ASCII RFC 3986 unreserved characters
 * inside path segments. Percent escapes are deliberately unsupported: rejecting
 * them avoids browser/server decode disagreements, encoded dot segments, and
 * encoded separators. Every accepted source has exactly one audit path.
 */

import { lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

const AUDIT_ORIGIN = 'https://juyiting-audit.invalid'
const RUNTIME_PREFIX = '/juyiting/'
const PUBLIC_PREFIX = 'public/juyiting/'
const SAFE_SEGMENT = /^[A-Za-z0-9._~-]+$/
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/
const VALID_PERCENT_ESCAPE = /^[0-9A-Fa-f]{2}$/

export function canonicalizeJuyitingRuntimeSource(source) {
  return canonicalize(source, 'runtime')
}

export function canonicalizeJuyitingTmxSource(source) {
  return canonicalize(source, 'tmx')
}

export function resolveJuyitingPublicFile(publicRoot, canonicalPublicPath) {
  if (typeof canonicalPublicPath !== 'string' || !canonicalPublicPath.startsWith(PUBLIC_PREFIX)) {
    throw new Error(`Expected canonical Juyiting public path, got ${JSON.stringify(canonicalPublicPath)}`)
  }
  const recanonicalized = canonicalizeJuyitingRuntimeSource(`/${canonicalPublicPath.slice('public/'.length)}`)
  if (recanonicalized !== canonicalPublicPath) {
    throw new Error(`Non-canonical Juyiting public path: ${canonicalPublicPath}`)
  }

  const root = resolve(publicRoot)
  let realRoot
  try {
    realRoot = realpathSync(root)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Juyiting public root is missing: ${root}`)
    throw error
  }

  const path = resolve(root, canonicalPublicPath.slice('public/'.length))
  const relation = relative(root, path)
  if (relation === '..' || relation.startsWith('../') || relation.startsWith('..\\') || isAbsolute(relation)) {
    throw new Error(`Juyiting public path escapes public root: ${canonicalPublicPath}`)
  }

  let realPath
  try {
    realPath = realpathSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Juyiting public file is missing: ${canonicalPublicPath}`)
    throw error
  }
  const realRelation = relative(realRoot, realPath)
  if (realRelation === '..' || realRelation.startsWith('../') || realRelation.startsWith('..\\') || isAbsolute(realRelation)) {
    throw new Error(`Juyiting public file resolves outside public root: ${canonicalPublicPath} -> ${realPath}`)
  }
  if (!lstatSync(realPath).isFile()) {
    throw new Error(`Juyiting public path is not a regular file: ${canonicalPublicPath}`)
  }
  return realPath
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
