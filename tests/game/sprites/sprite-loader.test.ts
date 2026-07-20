import assert from 'node:assert/strict'
import { describe, it } from 'mocha'

import {
  PERSONA_SPRITE_MANIFEST,
  type PersonaSpriteManifest,
} from '../../../src/game/sprites/personaSpriteManifest.js'
import { loadPersonaSprites } from '../../../src/game/sprites/spriteLoader.js'

const mutableManifest = (): PersonaSpriteManifest => structuredClone(PERSONA_SPRITE_MANIFEST)

describe('sprite loader', () => {
  it('keeps map readiness independent when a required persona fails to load', async () => {
    const mapReady = true
    const failingLoader = async () => {
      throw new Error('network unavailable')
    }

    const result = await loadPersonaSprites(failingLoader, PERSONA_SPRITE_MANIFEST)

    assert.equal(result.degraded, true)
    assert.equal(result.available.has('songjiang'), false)
    assert.equal(result.placeholderCount, 0)
    assert.equal(result.requiredMissingCount, 1)
    const songjiangError = result.errors.find(error => error.technicalMessage?.startsWith('songjiang:'))
    assert.equal(songjiangError?.code, 'REQUIRED_SPRITE_LOAD_FAILED')
    assert.equal(songjiangError?.severity, 'degraded')
    assert.equal(songjiangError?.retryable, true)
    assert.equal(mapReady, true)
  })

  it('makes only dimension-valid loaded personas available', async () => {
    const result = await loadPersonaSprites(async definition => ({
      width: definition.image.width,
      height: definition.image.height,
    }), PERSONA_SPRITE_MANIFEST)

    assert.equal(result.degraded, false)
    assert.deepEqual([...result.available], Object.keys(PERSONA_SPRITE_MANIFEST.personas))
    assert.equal(result.requiredMissingCount, 0)
    assert.equal(result.placeholderCount, 0)
    assert.equal(result.errors.length, 0)
  })

  it('degrades a dimension mismatch without substituting another persona', async () => {
    const result = await loadPersonaSprites(async () => ({ width: 512, height: 1024 }), PERSONA_SPRITE_MANIFEST)

    assert.equal(result.degraded, true)
    assert.equal(result.available.size, 0)
    assert.equal(result.placeholderCount, 0)
    assert.match(result.errors[0]?.technicalMessage ?? '', /1024x1024/)
    assert.equal(result.errors[0]?.retryable, false)
  })

  it('marks manifest identity and configuration failures as permanent', async () => {
    const identityManifest = mutableManifest()
    identityManifest.personas.songjiang.personaCode = 'wuyong'
    const identity = await loadPersonaSprites(async () => ({ width: 1024, height: 1024 }), identityManifest)
    assert.equal(identity.errors[0]?.retryable, false)

    const configManifest = mutableManifest()
    configManifest.personas.songjiang.frame.columns = 7
    let loadCalls = 0
    const config = await loadPersonaSprites(async () => {
      loadCalls += 1
      return { width: 1024, height: 1024 }
    }, configManifest)
    assert.equal(config.errors[0]?.retryable, false)
    assert.match(config.errors[0]?.technicalMessage ?? '', /frame grid/i)
    assert.equal(loadCalls, Object.keys(configManifest.personas).length - 1)

    const versionManifest = mutableManifest()
    versionManifest.version = 'persona-sheets-v2'
    const version = await loadPersonaSprites(async () => ({ width: 1024, height: 1024 }), versionManifest)
    assert.equal(version.errors[0]?.retryable, false)
    assert.match(version.errors[0]?.technicalMessage ?? '', /manifest version/i)
  })

  it('times out a never-settling load as a transient degraded failure', async () => {
    const result = await loadPersonaSprites(
      async () => new Promise(() => {}),
      PERSONA_SPRITE_MANIFEST,
      { timeoutMs: 15 },
    )

    assert.equal(result.degraded, true)
    assert.equal(result.available.has('songjiang'), false)
    assert.equal(result.errors[0]?.retryable, true)
    assert.match(result.errors[0]?.technicalMessage ?? '', /timed out/i)
  })
})
