import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export const sha256Buffer = buffer => createHash('sha256').update(buffer).digest('hex')
export const sha256File = path => sha256Buffer(readFileSync(path))

export function pngDimensions (buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

export function expectedMatrixContactSheets (matrixShots) {
  const firstByTarget = new Map()
  for (const shot of matrixShots) {
    if (!firstByTarget.has(shot.targetStableId)) firstByTarget.set(shot.targetStableId, shot)
  }
  return [...firstByTarget.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([target, shot]) => `cell-${shot.cell}-${target.replaceAll('/', '_').replaceAll('.', '_')}.png`)
    .sort()
}

export function exactDirectoryEntries (dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).sort()
}

export function compareExactNames (actual, expected) {
  const actualSorted = [...actual].sort()
  const expectedSorted = [...expected].sort()
  return {
    ok: JSON.stringify(actualSorted) === JSON.stringify(expectedSorted),
    actual: actualSorted,
    expected: expectedSorted,
    missing: expectedSorted.filter(name => !actualSorted.includes(name)),
    extras: actualSorted.filter(name => !expectedSorted.includes(name)),
  }
}

export function inspectPngFiles (dir, names, expectedDimensions) {
  const failures = []
  for (const name of names) {
    const path = resolve(dir, name)
    if (!existsSync(path)) {
      failures.push(`${name}:missing`)
      continue
    }
    const bytes = readFileSync(path)
    const dimensions = pngDimensions(bytes)
    if (!dimensions) {
      failures.push(`${name}:invalid-png`)
      continue
    }
    if (expectedDimensions && (dimensions.width !== expectedDimensions.width || dimensions.height !== expectedDimensions.height)) {
      failures.push(`${name}:${dimensions.width}x${dimensions.height} != ${expectedDimensions.width}x${expectedDimensions.height}`)
    }
  }
  return failures
}

export function resolveContainedEvidenceFile (rootDir, relativePath, expectedRelativePath) {
  if (typeof relativePath !== 'string') throw new Error('file path is not a string')
  if (relativePath !== expectedRelativePath) throw new Error(`file path ${JSON.stringify(relativePath)} != ${JSON.stringify(expectedRelativePath)}`)
  if (isAbsolute(relativePath)) throw new Error(`absolute file path is forbidden: ${relativePath}`)

  const rootReal = realpathSync(rootDir)
  const candidate = resolve(rootDir, relativePath)
  const lexical = relative(resolve(rootDir), candidate)
  if (lexical === '..' || lexical.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(lexical)) {
    throw new Error(`file path escapes evidence root: ${relativePath}`)
  }
  if (!existsSync(candidate)) throw new Error(`file missing: ${relativePath}`)
  if (lstatSync(candidate).isSymbolicLink()) throw new Error(`symlink evidence file is forbidden: ${relativePath}`)

  const candidateReal = realpathSync(candidate)
  const contained = relative(rootReal, candidateReal)
  if (contained === '..' || contained.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(contained)) {
    throw new Error(`realpath escapes evidence root: ${relativePath}`)
  }
  const parentReal = realpathSync(dirname(candidate))
  const parentContained = relative(rootReal, parentReal)
  if (parentContained === '..' || parentContained.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(parentContained)) {
    throw new Error(`parent realpath escapes evidence root: ${relativePath}`)
  }
  return candidateReal
}
