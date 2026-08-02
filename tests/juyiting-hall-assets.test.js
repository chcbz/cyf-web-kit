import { expect } from 'chai'
import { existsSync, readFileSync } from 'fs'

import { createGameConfig, HALL_SCENE_HEIGHT, HALL_SCENE_WIDTH } from '../src/game/config.js'
import {
  HALL_BOOT_RESOURCES,
  HALL_MAP_RESOURCE,
  buildHallMapResources,
  buildPersonaSpriteResource,
  personaSpriteResourceName
} from '../src/game/resources.js'
import { PERSONA_SPRITE_MANIFEST } from '../src/game/sprites/personaSpriteManifest.js'
import { parseJuyiHallTmx } from '../src/game/tiledMap.js'

const pngSize = (path) => {
  const bytes = readFileSync(path)
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  }
}

describe('Juyiting hall scene assets', () => {
  const hallV4Xml = readFileSync('public/juyiting/hall.tmx', 'utf8')
  const hallV4Map = parseJuyiHallTmx(hallV4Xml)

  it('uses the background native dimensions as the melonJS scene size', () => {
    const bg = pngSize('public/juyiting/images/liangshan-hall-base-clean-v3.png')
    const config = createGameConfig()

    expect(HALL_SCENE_WIDTH).to.equal(bg.width)
    expect(HALL_SCENE_HEIGHT).to.equal(bg.height)
    expect(config.width).to.equal(bg.width)
    expect(config.height).to.equal(bg.height)
  })

  it('keeps only non-map boot resources in the static JS manifest', () => {
    expect(HALL_BOOT_RESOURCES).to.deep.equal([
      HALL_MAP_RESOURCE
    ])
  })

  it('derives tileset and image layer resources from TMX map data', () => {
    const resources = buildHallMapResources(hallV4Map)

    expect(resources).to.deep.include.members([
      { name: 'liangshan-hall-base-clean-v3', type: 'image', src: '/juyiting/images/liangshan-hall-base-clean-v3.png' },
      { name: 'mid-occluders', type: 'image', src: '/juyiting/images/liangshan-hall-mid-occluders-v3.png' },
      { name: 'foreground-occluders', type: 'image', src: '/juyiting/images/liangshan-hall-foreground-occluders-v3.png' },
      { name: 'lighting-overlay', type: 'image', src: '/juyiting/images/liangshan-hall-lighting-overlay-v3.png' }
    ])
    expect(resources.map(resource => resource.name)).not.to.include(personaSpriteResourceName('songjiang'))
    expect(buildPersonaSpriteResource(PERSONA_SPRITE_MANIFEST.personas.songjiang)).to.deep.equal({
      name: personaSpriteResourceName('songjiang'),
      type: 'image',
      src: '/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v3.png'
    })
    expect(resources.map(resource => resource.name)).not.to.include('prop-gate')
    expect(resources.map(resource => resource.src).join('\n')).not.to.include('gate')
  })

  it('keeps TMX-derived image layer resources backed by public files', () => {
    buildHallMapResources(hallV4Map).forEach(resource => {
      if (!resource.src?.startsWith('/juyiting/')) return
      const relativePath = resource.src.replace('/juyiting/', 'public/juyiting/')
      expect(existsSync(relativePath), resource.name).to.equal(true)
    })
  })

  it('does not import the old JS scene layer manifest from resources.js', () => {
    const source = readFileSync('src/game/resources.js', 'utf8')
    expect(source).not.to.include('hallSceneLayers')
    expect(source).not.to.include('HALL_SCENE_LAYER_RESOURCES')
    expect(source).not.to.include('HALL_PROP_CROPPED_RESOURCES')
  })
})
