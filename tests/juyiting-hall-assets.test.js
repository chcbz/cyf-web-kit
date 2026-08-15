import { expect } from 'chai'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'fs'

import { createGameConfig, HALL_SCENE_HEIGHT, HALL_SCENE_WIDTH } from '../src/game/config.js'
import {
  HALL_BOOT_RESOURCES,
  HALL_MAP_RESOURCE,
  HALL_MAP_VERSION,
  buildHallMapResources,
  buildPersonaSpriteResource,
  personaSpriteResourceName
} from '../src/game/resources.js'
import { PERSONA_SPRITE_MANIFEST } from '../src/game/sprites/personaSpriteManifest.js'
import { parseJuyiHallTmx } from '../src/game/tiledMap.js'
import { ACCEPTED_TMX_SHA256 } from '../src/game/occlusion/hallSceneAssembly.js'

const imageSize = (path) => {
  const bytes = readFileSync(path)
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    let offset = 12
    while (offset + 8 <= bytes.length) {
      const type = bytes.subarray(offset, offset + 4).toString('ascii')
      const length = bytes.readUInt32LE(offset + 4)
      const chunk = bytes.subarray(offset + 8, offset + 8 + length)
      if (type === 'VP8X' && chunk.length >= 10) return { width: 1 + chunk.readUIntLE(4, 3), height: 1 + chunk.readUIntLE(7, 3) }
      if (type === 'VP8 ' && chunk.length >= 10) return { width: chunk.readUInt16LE(6) & 0x3fff, height: chunk.readUInt16LE(8) & 0x3fff }
      offset += 8 + length + (length % 2)
    }
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  }
}

describe('Juyiting hall scene assets', () => {
  const hallV4Xml = readFileSync('public/juyiting/hall.tmx', 'utf8')
  const hallV4Map = parseJuyiHallTmx(hallV4Xml)

  it('uses the background native dimensions as the melonJS scene size', () => {
    const bg = imageSize('public/juyiting/images/liangshan-hall-base-clean-v3.webp')
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

  it('cache-busts hall.tmx with the exact V2-accepted content hash', () => {
    const hallTmxSha256 = createHash('sha256').update(readFileSync('public/juyiting/hall.tmx')).digest('hex')
    const resourceUrl = new URL(HALL_MAP_RESOURCE.src, 'https://juyiting.test/')

    expect(HALL_MAP_VERSION).to.equal(hallTmxSha256)
    expect(HALL_MAP_VERSION).to.equal(ACCEPTED_TMX_SHA256)
    expect(resourceUrl.pathname).to.equal('/juyiting/hall.tmx')
    expect(resourceUrl.searchParams.getAll('v')).to.deep.equal([hallTmxSha256])
    expect([...resourceUrl.searchParams.keys()]).to.deep.equal(['v'])
  })

  it('derives tileset and image layer resources from TMX map data', () => {
    const resources = buildHallMapResources(hallV4Map)

    expect(resources).to.deep.include.members([
      { name: 'liangshan-hall-base-clean-v3', type: 'image', src: '/juyiting/images/liangshan-hall-base-clean-v3.webp' },
      { name: 'mid-occluders', type: 'image', src: '/juyiting/images/liangshan-hall-mid-occluders-v3.webp' },
      { name: 'foreground-occluders', type: 'image', src: '/juyiting/images/liangshan-hall-mid-occluders-v3.webp' },
      { name: 'lighting-overlay', type: 'image', src: '/juyiting/images/liangshan-hall-lighting-overlay-v3.webp' }
    ])
    expect(resources.map(resource => resource.name)).not.to.include(personaSpriteResourceName('songjiang'))
    expect(resources.map(resource => resource.src)).not.to.include('/juyiting/images/liangshan-hall-foreground-occluders-v3.webp')
    expect(buildPersonaSpriteResource(PERSONA_SPRITE_MANIFEST.personas.songjiang)).to.deep.equal({
      name: personaSpriteResourceName('songjiang'),
      type: 'image',
      src: '/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v3.webp'
    })
    expect(resources.map(resource => resource.name)).not.to.include('prop-gate')
    expect(resources.map(resource => resource.src).join('\n')).not.to.include('gate')

    const v2Atlases = resources.filter(resource => resource.src.includes('/images/occluders/'))
    expect(v2Atlases).to.have.length(6)
    expect(v2Atlases.map(resource => resource.name).sort()).to.deep.equal([
      'center-v2',
      'east-lower-v2',
      'east-upper-v2',
      'entrance-v2',
      'west-lower-v2',
      'west-upper-v2'
    ])
    expect(v2Atlases.every(resource => !resource.name.includes('/') && !resource.name.endsWith('.png'))).to.equal(true)
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

  it('deduplicates image resources with identical name and src idempotently', () => {
    const mapData = {
      tilesets: [
        { tilesetResourceName: 'duplicate-sheet', imageSource: '/juyiting/images/occluders/center-v2.png' },
        { tilesetResourceName: 'duplicate-sheet', imageSource: '/juyiting/images/occluders/center-v2.png' }
      ],
      imageLayers: {},
      layers: []
    }
    const resources = buildHallMapResources(mapData)
    const matches = resources.filter(resource => resource.name === 'duplicate-sheet')
    expect(matches).to.have.length(1)
    expect(matches[0]).to.deep.equal({
      name: 'duplicate-sheet',
      type: 'image',
      src: '/juyiting/images/occluders/center-v2.png'
    })
  })

  it('deduplicates collection-of-images tiles with identical resourceName and source', () => {
    const mapData = {
      tilesets: [
        {
          tilesetResourceName: 'prop-sheet',
          tiles: [
            { resourceName: 'prop-sheet-tile-3', source: '/juyiting/images/occluders/center-v2.png' },
            { resourceName: 'prop-sheet-tile-3', source: '/juyiting/images/occluders/center-v2.png' }
          ]
        }
      ],
      imageLayers: {},
      layers: []
    }
    const resources = buildHallMapResources(mapData)
    const matches = resources.filter(resource => resource.name === 'prop-sheet-tile-3')
    expect(matches).to.have.length(1)
    expect(matches[0]).to.deep.equal({
      name: 'prop-sheet-tile-3',
      type: 'image',
      src: '/juyiting/images/occluders/center-v2.png'
    })
  })

  it('throws fail-closed when the same resource name maps to different srcs', () => {
    const mapData = {
      tilesets: [
        { tilesetResourceName: 'colliding-sheet', imageSource: '/juyiting/images/a/colliding-sheet.png' },
        { tilesetResourceName: 'colliding-sheet', imageSource: '/juyiting/images/b/colliding-sheet.png' }
      ],
      imageLayers: {},
      layers: []
    }
    let caught
    try {
      buildHallMapResources(mapData)
    } catch (error) {
      caught = error
    }
    expect(caught).to.be.instanceOf(Error)
    expect(caught.message).to.include('colliding-sheet')
    expect(caught.message).to.include('/juyiting/images/a/colliding-sheet.png')
    expect(caught.message).to.include('/juyiting/images/b/colliding-sheet.png')
  })

  it('throws fail-closed when collection-of-images tiles share a name but map to different srcs', () => {
    const mapData = {
      tilesets: [
        {
          tilesetResourceName: 'prop-sheet',
          tiles: [
            { resourceName: 'prop-sheet-tile-3', source: '/juyiting/images/a/prop-sheet-tile-3.png' },
            { resourceName: 'prop-sheet-tile-3', source: '/juyiting/images/b/prop-sheet-tile-3.png' }
          ]
        }
      ],
      imageLayers: {},
      layers: []
    }
    let caught
    try {
      buildHallMapResources(mapData)
    } catch (error) {
      caught = error
    }
    expect(caught).to.be.instanceOf(Error)
    expect(caught.message).to.include('prop-sheet-tile-3')
    expect(caught.message).to.include('/juyiting/images/a/prop-sheet-tile-3.png')
    expect(caught.message).to.include('/juyiting/images/b/prop-sheet-tile-3.png')
  })

  it('deduplicates image layers with identical resourceName and source', () => {
    const mapData = {
      tilesets: [],
      imageLayers: {
        'dup-a': { resourceName: 'lighting-overlay-dup', source: '/juyiting/images/liangshan-hall-lighting-overlay-v3.webp' },
        'dup-b': { resourceName: 'lighting-overlay-dup', source: '/juyiting/images/liangshan-hall-lighting-overlay-v3.webp' }
      },
      layers: []
    }
    const resources = buildHallMapResources(mapData)
    const matches = resources.filter(resource => resource.name === 'lighting-overlay-dup')
    expect(matches).to.have.length(1)
    expect(matches[0]).to.deep.equal({
      name: 'lighting-overlay-dup',
      type: 'image',
      src: '/juyiting/images/liangshan-hall-lighting-overlay-v3.webp'
    })
  })

  it('throws fail-closed when image layers share a name but map to different srcs', () => {
    const mapData = {
      tilesets: [],
      imageLayers: {
        'col-a': { resourceName: 'lighting-overlay-collide', source: '/juyiting/images/a/lighting-overlay-collide.webp' },
        'col-b': { resourceName: 'lighting-overlay-collide', source: '/juyiting/images/b/lighting-overlay-collide.webp' }
      },
      layers: []
    }
    let caught
    try {
      buildHallMapResources(mapData)
    } catch (error) {
      caught = error
    }
    expect(caught).to.be.instanceOf(Error)
    expect(caught.message).to.include('lighting-overlay-collide')
    expect(caught.message).to.include('/juyiting/images/a/lighting-overlay-collide.webp')
    expect(caught.message).to.include('/juyiting/images/b/lighting-overlay-collide.webp')
  })

  it('deduplicates V2 atlas assetRefs with the same basename and src', () => {
    const mapData = {
      tilesets: [],
      imageLayers: {},
      layers: [
        {
          type: 'objectgroup',
          name: 'v2-fragments-occluders',
          objects: [
            { properties: { assetRef: 'images/occluders/center-v2.png' } },
            { properties: { assetRef: '/images/occluders/center-v2.png' } }
          ]
        }
      ]
    }
    const resources = buildHallMapResources(mapData)
    const matches = resources.filter(resource => resource.src === '/juyiting/images/occluders/center-v2.png')
    expect(matches).to.have.length(1)
    expect(matches[0]).to.deep.equal({
      name: 'center-v2',
      type: 'image',
      src: '/juyiting/images/occluders/center-v2.png'
    })
  })

  it('throws fail-closed when two V2 atlas assetRefs share a basename across directories', () => {
    const mapData = {
      tilesets: [],
      imageLayers: {},
      layers: [
        {
          type: 'objectgroup',
          name: 'v2-fragments-occluders',
          objects: [
            { properties: { assetRef: 'images/occluders/legacy/center-v2.png' } },
            { properties: { assetRef: 'images/occluders/retry/center-v2.png' } }
          ]
        }
      ]
    }
    let caught
    try {
      buildHallMapResources(mapData)
    } catch (error) {
      caught = error
    }
    expect(caught).to.be.instanceOf(Error)
    expect(caught.message).to.include('center-v2')
    expect(caught.message).to.include('/juyiting/images/occluders/legacy/center-v2.png')
    expect(caught.message).to.include('/juyiting/images/occluders/retry/center-v2.png')
  })
})
