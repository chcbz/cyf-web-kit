import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'mocha'
import {
  PERSONA_SPRITE_MANIFEST,
  type PersonaSpriteManifest,
} from '../../../src/game/sprites/personaSpriteManifest.js'
import { resolvePersonaSprite } from '../../../src/game/sprites/animationResolver.js'
import {
  type SpriteAssetInspection,
  validateSpriteManifest,
} from '../../../src/game/sprites/spriteValidation.js'
import { fileURLToPath } from 'node:url'
// The release CLI intentionally stays a directly executable ESM script.
// @ts-expect-error No declaration file is emitted for the repository-local CLI module.
import { inspectPngFile, runValidateSprites } from '../../../scripts/juyiting/validate-sprites.mjs'

function mutableManifest(): PersonaSpriteManifest {
  return structuredClone(PERSONA_SPRITE_MANIFEST)
}

function fixturePath(): string {
  return fileURLToPath(new URL(
    './fixtures/public/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v2.png', import.meta.url,
  ))
}

function inspectTemporaryPng(bytes: Buffer): ReturnType<typeof inspectPngFile> {
  const directory = mkdtempSync(join(tmpdir(), 'juyiting-png-'))
  const path = join(directory, 'sprite.png')
  try {
    writeFileSync(path, bytes)
    return inspectPngFile(path)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function chunkOffset(bytes: Buffer, target: string): number {
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    if (bytes.subarray(offset + 4, offset + 8).toString('ascii') === target) return offset
    offset += length + 12
  }
  return -1
}

describe('sprite manifest', () => {
  it('requires Songjiang and never resolves an unknown persona to Songjiang', () => {
    const result = validateSpriteManifest(PERSONA_SPRITE_MANIFEST)

    assert.equal(result.requiredMissingCount, 0)
    assert.equal(resolvePersonaSprite('songjiang', PERSONA_SPRITE_MANIFEST)?.personaCode, 'songjiang')
    assert.equal(resolvePersonaSprite('unknown-persona', PERSONA_SPRITE_MANIFEST), null)
  })

  it('requires idle and walk animations with valid frame bounds', () => {
    const manifest = mutableManifest()
    manifest.personas.songjiang.animations.idle.down.frames = []
    manifest.personas.songjiang.animations.walk.up.frames = [64]

    const result = validateSpriteManifest(manifest)

    assert.equal(result.requiredMissingCount, 1)
    assert.ok(result.errors.map(error => error.code).includes('REQUIRED_SPRITE_LOAD_FAILED'))
  })

  it('reports Songjiang missing when the required manifest entry is absent', () => {
    const manifest = mutableManifest()
    delete manifest.personas.songjiang

    const result = validateSpriteManifest(manifest)

    assert.equal(result.requiredMissingCount, 1)
    assert.ok(result.errors.some(error => error.code === 'REQUIRED_SPRITE_LOAD_FAILED'))
  })

  it('counts a required identity mismatch as both missing and substituted', () => {
    const manifest = mutableManifest()
    manifest.personas.songjiang.personaCode = 'not-songjiang'

    const result = validateSpriteManifest(manifest)

    assert.equal(result.requiredMissingCount, 1)
    assert.equal(result.substitutionCount, 1)
    assert.ok(result.errors.some(error => error.code === 'REQUIRED_SPRITE_LOAD_FAILED'))
    assert.ok(result.errors.some(error => error.code === 'SPRITE_SUBSTITUTION_DETECTED'))
  })

  it('validates manifest version and sheet dimensions', () => {
    const manifest = mutableManifest()
    manifest.version = 'persona-sheets-v2'
    manifest.personas.songjiang.image.width = 1000

    const result = validateSpriteManifest(manifest)

    assert.equal(result.substitutionCount, 0)
    assert.ok(result.errors.map(error => error.code).includes('SPRITE_MANIFEST_VERSION_MISMATCH'))
    assert.ok(result.errors.map(error => error.code).includes('REQUIRED_SPRITE_LOAD_FAILED'))
  })

  it('accepts a matching inspected PNG and rejects bad signatures or dimensions', () => {
    const valid = validateSpriteManifest(PERSONA_SPRITE_MANIFEST, {
      assets: {
        songjiang: inspectPngFile(fixturePath()),
      },
    })
    assert.equal(valid.valid, true)

    const invalid = validateSpriteManifest(PERSONA_SPRITE_MANIFEST, {
      assets: {
        songjiang: {
          exists: true, signatureValid: false, structurallyValid: false, decodable: false,
          width: 512, height: 1024, error: 'invalid signature fixture',
        },
      },
    })
    assert.equal(invalid.requiredMissingCount, 1)
    assert.ok(invalid.errors.map(error => error.code).includes('REQUIRED_SPRITE_LOAD_FAILED'))
  })

  it('rejects interlaced, 16-bit, and non-RGBA PNG formats before decoding', () => {
    const valid = readFileSync(fixturePath())
    const interlaced = Buffer.from(valid)
    interlaced[28] = 1
    const sixteenBit = Buffer.from(valid)
    sixteenBit[24] = 16
    const rgb = Buffer.from(valid)
    rgb[25] = 2

    const cases = [
      { bytes: interlaced, message: /interlac/i },
      { bytes: sixteenBit, message: /RGBA8/ },
      { bytes: rgb, message: /RGBA8/ },
    ]
    for (const entry of cases) {
      const inspection = inspectTemporaryPng(entry.bytes)
      assert.equal(inspection.decodable, false)
      assert.match(inspection.error, entry.message)
    }
  })

  it('fails closed for an incomplete external inspection object', () => {
    const weakInspection = {
      exists: true,
      signatureValid: true,
      width: 1024,
      height: 1024,
    } as unknown as SpriteAssetInspection

    const result = validateSpriteManifest(PERSONA_SPRITE_MANIFEST, {
      assets: { songjiang: weakInspection },
    })

    assert.equal(result.releaseValid, false)
    assert.equal(result.requiredMissingCount, 1)
    assert.ok(result.errors.some(error => error.code === 'REQUIRED_SPRITE_LOAD_FAILED'))
  })

  it('rejects header-only, truncated, bad-CRC, and missing-IEND PNG files', () => {
    const valid = readFileSync(fixturePath())
    const idat = chunkOffset(valid, 'IDAT')
    assert.ok(idat >= 0)
    const idatLength = valid.readUInt32BE(idat)
    const badCrc = Buffer.from(valid)
    badCrc[idat + 8 + idatLength] ^= 0xff

    const malformed = [
      valid.subarray(0, 24),
      valid.subarray(0, valid.length - 4),
      badCrc,
      valid.subarray(0, valid.length - 12),
    ]
    for (const bytes of malformed) {
      const inspection = inspectTemporaryPng(bytes)
      assert.equal(inspection.decodable, false)
      const result = validateSpriteManifest(PERSONA_SPRITE_MANIFEST, { assets: { songjiang: inspection } })
      assert.equal(result.releaseValid, false)
      assert.equal(result.requiredMissingCount, 1)
    }
  })

  it('treats an optional missing sprite as a non-fatal degraded warning', () => {
    const manifest = mutableManifest()
    manifest.personas.wuyong = {
      ...structuredClone(manifest.personas.songjiang),
      personaCode: 'wuyong',
      required: false,
      src: '/juyiting/sprites/persona-sheets-v1/wuyong.png',
    }

    const result = validateSpriteManifest(manifest, {
      assets: { songjiang: inspectPngFile(fixturePath()) },
    })

    assert.equal(result.optionalMissingCount, 1)
    assert.equal(result.degraded, true)
    assert.equal(result.valid, true)
    assert.equal(result.releaseValid, true)
    assert.equal(result.errors.length, 0)
    assert.ok(result.warnings.some(warning => warning.code === 'OPTIONAL_SPRITE_LOAD_FAILED'))
  })

  it('passes the release validator against the fixture public root', () => {
    const publicRoot = fileURLToPath(new URL('./fixtures/public', import.meta.url))

    const result = runValidateSprites({ JIA_JUYITING_PUBLIC_ROOT: publicRoot })

    assert.equal(result.requiredMissingCount, 0)
    assert.equal(result.substitutionCount, 0)
  })
})
