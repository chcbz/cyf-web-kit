import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import {
  PERSONA_SPRITE_MANIFEST,
  type PersonaSpriteManifest,
} from '../../../src/game/sprites/personaSpriteManifest.js'
import { resolvePersonaSprite } from '../../../src/game/sprites/animationResolver.js'
import { validateSpriteManifest } from '../../../src/game/sprites/spriteValidation.js'
import { fileURLToPath } from 'node:url'
// The release CLI intentionally stays a directly executable ESM script.
// @ts-expect-error No declaration file is emitted for the repository-local CLI module.
import { inspectPngFile, runValidateSprites } from '../../../scripts/juyiting/validate-sprites.mjs'

function mutableManifest(): PersonaSpriteManifest {
  return structuredClone(PERSONA_SPRITE_MANIFEST)
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
    manifest.personas.songjiang.animations.idle.frames = []
    manifest.personas.songjiang.animations.walk.frames = [16]

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

  it('validates manifest version, sheet dimensions, and substitutions', () => {
    const manifest = mutableManifest()
    manifest.version = 'persona-sheets-v2'
    manifest.personas.songjiang.image.width = 1000
    manifest.personas.songjiang.personaCode = 'not-songjiang'

    const result = validateSpriteManifest(manifest)

    assert.equal(result.substitutionCount, 1)
    assert.ok(result.errors.map(error => error.code).includes('SPRITE_MANIFEST_VERSION_MISMATCH'))
    assert.ok(result.errors.map(error => error.code).includes('REQUIRED_SPRITE_LOAD_FAILED'))
    assert.ok(result.errors.map(error => error.code).includes('SPRITE_SUBSTITUTION_DETECTED'))
  })

  it('accepts a matching inspected PNG and rejects bad signatures or dimensions', () => {
    const fixture = fileURLToPath(new URL(
      './fixtures/public/juyiting/sprites/persona-sheets-v1/songjiang.png', import.meta.url,
    ))
    const valid = validateSpriteManifest(PERSONA_SPRITE_MANIFEST, {
      assets: {
        songjiang: inspectPngFile(fixture),
      },
    })
    assert.equal(valid.valid, true)

    const invalid = validateSpriteManifest(PERSONA_SPRITE_MANIFEST, {
      assets: {
        songjiang: { exists: true, signatureValid: false, width: 512, height: 256 },
      },
    })
    assert.equal(invalid.requiredMissingCount, 1)
    assert.ok(invalid.errors.map(error => error.code).includes('REQUIRED_SPRITE_LOAD_FAILED'))
  })

  it('passes the release validator against the fixture public root', () => {
    const publicRoot = fileURLToPath(new URL('./fixtures/public', import.meta.url))

    const result = runValidateSprites({ JIA_JUYITING_PUBLIC_ROOT: publicRoot })

    assert.equal(result.requiredMissingCount, 0)
    assert.equal(result.substitutionCount, 0)
  })
})
