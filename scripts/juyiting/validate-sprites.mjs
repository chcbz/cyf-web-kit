import { Buffer } from 'node:buffer'
import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import pngjs from 'pngjs'

import { PERSONA_SPRITE_MANIFEST } from '../../src/game/sprites/personaSpriteManifest.ts'
import { validateSpriteManifest } from '../../src/game/sprites/spriteValidation.ts'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const RIFF_SIGNATURE = Buffer.from('RIFF')
const WEBP_SIGNATURE = Buffer.from('WEBP')
const MAX_PNG_BYTES = 64 * 1024 * 1024
const MAX_IMAGE_BYTES = 64 * 1024 * 1024
const MAX_DECODED_BYTES = 64 * 1024 * 1024
const BYTES_PER_PIXEL = 4
const MAX_PIXELS = MAX_DECODED_BYTES / BYTES_PER_PIXEL
const { PNG } = pngjs

export function inspectPngFile(path) {
  return inspectSpriteImageFile(path)
}

export function inspectSpriteImageFile(path) {
  let bytes
  try {
    const stat = statSync(path)
    if (!stat.isFile()) return invalidInspection(false, 'sprite path is not a regular file')
    if (stat.size > MAX_IMAGE_BYTES) return invalidInspection(false, `sprite image exceeds ${MAX_IMAGE_BYTES} bytes`)
    bytes = readFileSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return invalidInspection(false, 'sprite image is missing', false)
    throw new Error(`Unable to read sprite image at ${path}: ${errorCode(error)}`)
  }

  if (bytes.length > MAX_IMAGE_BYTES) return invalidInspection(false, `sprite image exceeds ${MAX_IMAGE_BYTES} bytes`)
  return inspectSpriteImageBytes(bytes)
}

export function inspectSpriteImageBytes(bytes) {
  if (isWebpBytes(bytes)) return inspectWebpBytes(bytes)
  return inspectPngBytes(bytes)
}

export function inspectPngBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return invalidInspection(false, 'sprite PNG signature is invalid')
  }
  if (bytes.length > MAX_PNG_BYTES) return invalidInspection(true, `sprite PNG exceeds ${MAX_PNG_BYTES} bytes`)

  let offset = PNG_SIGNATURE.length
  let width
  let height
  let sawIdat = false
  let chunkIndex = 0
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) return invalidInspection(true, 'sprite PNG has a truncated chunk')
    const length = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    const chunkEnd = offset + 12 + length
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > bytes.length) {
      return invalidInspection(true, `sprite PNG ${type || 'unknown'} chunk exceeds file bounds`)
    }
    if (chunkIndex === 0) {
      if (type !== 'IHDR' || length !== 13) return invalidInspection(true, 'sprite PNG must start with a 13-byte IHDR')
      width = bytes.readUInt32BE(offset + 8)
      height = bytes.readUInt32BE(offset + 12)
      const bitDepth = bytes[offset + 16]
      const colorType = bytes[offset + 17]
      const compressionMethod = bytes[offset + 18]
      const filterMethod = bytes[offset + 19]
      const interlaceMethod = bytes[offset + 20]
      if (bitDepth !== 8 || colorType !== 6) {
        return invalidInspection(true, 'sprite PNG must use RGBA8 (bit depth 8, color type 6)')
      }
      if (compressionMethod !== 0 || filterMethod !== 0) {
        return invalidInspection(true, 'sprite PNG must use PNG compression and filter methods 0')
      }
      if (interlaceMethod !== 0) return invalidInspection(true, 'sprite PNG interlacing is not supported')
      const pixels = width * height
      const decodedBytes = pixels * BYTES_PER_PIXEL
      if (width === 0 || height === 0 || !Number.isSafeInteger(pixels) || pixels > MAX_PIXELS
        || !Number.isSafeInteger(decodedBytes) || decodedBytes > MAX_DECODED_BYTES) {
        return invalidInspection(true, 'sprite PNG decoded dimensions exceed the validation bound')
      }
    } else if (type === 'IHDR') return invalidInspection(true, 'sprite PNG contains multiple IHDR chunks')

    if (type === 'IDAT' && length > 0) sawIdat = true
    if (type === 'IEND') {
      if (length !== 0) return invalidInspection(true, 'sprite PNG IEND chunk must be empty')
      if (!sawIdat) return invalidInspection(true, 'sprite PNG contains no meaningful IDAT data')
      if (chunkEnd !== bytes.length) return invalidInspection(true, 'sprite PNG contains data after terminal IEND')
      try {
        const decoded = PNG.sync.read(bytes, { checkCRC: true })
        if (decoded.width !== width || decoded.height !== height || decoded.data.length !== width * height * BYTES_PER_PIXEL) {
          return invalidInspection(true, 'sprite PNG decoded output does not match IHDR dimensions')
        }
      } catch (error) {
        return invalidInspection(true, `sprite PNG is not decodable: ${error instanceof Error ? error.message : String(error)}`)
      }
      return { exists: true, signatureValid: true, structurallyValid: true, decodable: true, width, height }
    }
    offset = chunkEnd
    chunkIndex += 1
  }
  return invalidInspection(true, 'sprite PNG is missing terminal IEND')
}

export function inspectWebpBytes(bytes) {
  if (!isWebpBytes(bytes)) return invalidInspection(false, 'sprite WebP signature is invalid')
  if (bytes.length > MAX_IMAGE_BYTES) return invalidInspection(true, `sprite WebP exceeds ${MAX_IMAGE_BYTES} bytes`)

  let offset = 12
  while (offset + 8 <= bytes.length) {
    const type = bytes.subarray(offset, offset + 4).toString('ascii')
    const length = bytes.readUInt32LE(offset + 4)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (!Number.isSafeInteger(dataEnd) || dataEnd > bytes.length) {
      return invalidInspection(true, `sprite WebP ${type || 'unknown'} chunk exceeds file bounds`)
    }
    const chunk = bytes.subarray(dataStart, dataEnd)
    const dimensions = webpChunkDimensions(type, chunk)
    if (dimensions) {
      const { width, height } = dimensions
      if (!validDecodedDimensions(width, height)) return invalidInspection(true, 'sprite WebP decoded dimensions exceed the validation bound')
      return { exists: true, signatureValid: true, structurallyValid: true, decodable: true, width, height }
    }
    offset = dataEnd + (length % 2)
  }
  return invalidInspection(true, 'sprite WebP is missing a supported image chunk')
}

function isWebpBytes(bytes) {
  return Buffer.isBuffer(bytes)
    && bytes.length >= 12
    && bytes.subarray(0, 4).equals(RIFF_SIGNATURE)
    && bytes.subarray(8, 12).equals(WEBP_SIGNATURE)
}

function webpChunkDimensions(type, chunk) {
  if (type === 'VP8X' && chunk.length >= 10) {
    return {
      width: 1 + chunk.readUIntLE(4, 3),
      height: 1 + chunk.readUIntLE(7, 3)
    }
  }
  if (type === 'VP8L' && chunk.length >= 5 && chunk[0] === 0x2f) {
    const b0 = chunk[1]
    const b1 = chunk[2]
    const b2 = chunk[3]
    const b3 = chunk[4]
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
    }
  }
  if (type === 'VP8 ' && chunk.length >= 10
    && chunk[3] === 0x9d && chunk[4] === 0x01 && chunk[5] === 0x2a) {
    return {
      width: chunk.readUInt16LE(6) & 0x3fff,
      height: chunk.readUInt16LE(8) & 0x3fff
    }
  }
  return null
}

function validDecodedDimensions(width, height) {
  const pixels = width * height
  const decodedBytes = pixels * BYTES_PER_PIXEL
  return width > 0 && height > 0 && Number.isSafeInteger(pixels) && pixels <= MAX_PIXELS
    && Number.isSafeInteger(decodedBytes) && decodedBytes <= MAX_DECODED_BYTES
}

export function runValidateSprites(environment = process.env) {
  const publicRoot = resolve(
    environment.JIA_JUYITING_PUBLIC_ROOT
      ?? fileURLToPath(new URL('../../public', import.meta.url))
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

  if (!result.releaseValid) {
    throw new Error(`Juyiting sprite validation failed:\n${result.errors.map(error => `${error.code}: ${error.message}`).join('\n')}`)
  }
  return result
}

function invalidInspection(signatureValid, error, exists = true) {
  return { exists, signatureValid, structurallyValid: false, decodable: false, error }
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
