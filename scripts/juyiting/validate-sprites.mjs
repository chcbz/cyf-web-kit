import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PERSONA_SPRITE_MANIFEST } from '../../src/game/sprites/personaSpriteManifest.ts'
import { validateSpriteManifest } from '../../src/game/sprites/spriteValidation.ts'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export function inspectPngFile(path) {
  let bytes
  try {
    bytes = readFileSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, signatureValid: false }
    throw new Error(`Unable to read sprite PNG at ${path}: ${errorCode(error)}`)
  }

  const signatureValid = bytes.length >= 24
    && bytes.subarray(0, 8).equals(PNG_SIGNATURE)
    && bytes.subarray(12, 16).toString('ascii') === 'IHDR'
  if (!signatureValid) return { exists: true, signatureValid: false }
  return {
    exists: true,
    signatureValid: true,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  }
}

export function runValidateSprites(environment = process.env) {
  const publicRoot = resolve(
    environment.JIA_JUYITING_PUBLIC_ROOT
      ?? fileURLToPath(new URL('../../public', import.meta.url)),
  )
  const assets = Object.fromEntries(Object.entries(PERSONA_SPRITE_MANIFEST.personas).map(([personaCode, definition]) => {
    const path = resolvePublicAsset(publicRoot, definition.src)
    return [personaCode, inspectPngFile(path)]
  }))
  const result = validateSpriteManifest(PERSONA_SPRITE_MANIFEST, { assets, substitutionCount: 0 })

  console.log(`Juyiting sprite manifest: ${result.manifestVersion}`)
  console.log(`Required missing: ${result.requiredMissingCount}`)
  console.log(`Optional missing: ${result.optionalMissingCount}`)
  console.log(`Substitution count: ${result.substitutionCount}`)

  const releaseErrors = result.errors.filter(error =>
    error.code === 'SPRITE_MANIFEST_VERSION_MISMATCH'
    || error.code === 'REQUIRED_SPRITE_LOAD_FAILED'
    || error.code === 'SPRITE_SUBSTITUTION_DETECTED')
  if (releaseErrors.length > 0) {
    throw new Error(`Juyiting sprite validation failed:\n${releaseErrors.map(error => `${error.code}: ${error.message}`).join('\n')}`)
  }
  return result
}

function resolvePublicAsset(publicRoot, source) {
  const relativeSource = source.replace(/^[/\\]+/, '')
  const path = resolve(publicRoot, relativeSource)
  const relation = relative(publicRoot, path)
  if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`Sprite source escapes public root: ${source}`)
  }
  return path
}

function errorCode(error) {
  return error?.code ? `${error.code}: ${error.message}` : String(error)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runValidateSprites() } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
