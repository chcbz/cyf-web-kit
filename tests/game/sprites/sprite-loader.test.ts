import assert from 'node:assert/strict'
import { describe, it } from 'mocha'

import {
  PERSONA_SPRITE_MANIFEST,
} from '../../../src/game/sprites/personaSpriteManifest.js'
import { loadPersonaSprites } from '../../../src/game/sprites/spriteLoader.js'

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
    assert.equal(result.errors[0]?.code, 'REQUIRED_SPRITE_LOAD_FAILED')
    assert.equal(result.errors[0]?.severity, 'degraded')
    assert.equal(mapReady, true)
  })

  it('makes only dimension-valid loaded personas available', async () => {
    const result = await loadPersonaSprites(async definition => ({
      width: definition.image.width,
      height: definition.image.height,
    }), PERSONA_SPRITE_MANIFEST)

    assert.equal(result.degraded, false)
    assert.deepEqual([...result.available], ['songjiang'])
    assert.equal(result.requiredMissingCount, 0)
    assert.equal(result.placeholderCount, 0)
    assert.equal(result.errors.length, 0)
  })

  it('degrades a dimension mismatch without substituting another persona', async () => {
    const result = await loadPersonaSprites(async () => ({ width: 512, height: 256 }), PERSONA_SPRITE_MANIFEST)

    assert.equal(result.degraded, true)
    assert.equal(result.available.size, 0)
    assert.equal(result.placeholderCount, 0)
    assert.match(result.errors[0]?.technicalMessage ?? '', /1024x256/)
  })
})
