import { expect } from 'chai'
import { readFileSync } from 'fs'
import * as TMXUtils from 'melonjs/dist/melonjs.mjs/level/tiled/TMXUtils.js'

import { parseJuyiHallTmx, rectToPercent } from '../src/game/tiledMap.js'

describe('Juyi Hall Tiled map parser', () => {
  const hallV4Xml = readFileSync(new URL('../public/juyiting/hall.tmx', import.meta.url), 'utf8')

  it('parses runtime TMX image layers, hotspots, obstacles, and prop tiles from hall.tmx', () => {
    const map = parseJuyiHallTmx(hallV4Xml)

    expect(map.width).to.equal(1664)
    expect(map.height).to.equal(928)
    expect(map.coordinateWidth).to.equal(1664)
    expect(map.coordinateHeight).to.equal(928)
    expect(map.tileLayers.find(layer => layer.name === 'background').data).to.have.length(104 * 58)
    expect(map.imageLayers['mid-occluders'].source).to.equal('/juyiting/images/liangshan-hall-mid-occluders-v3.png')
    expect(map.imageLayers['lighting-overlay'].source).to.equal('/juyiting/images/liangshan-hall-lighting-overlay-v3.png')
    expect(map.imageLayers).not.to.have.property('prop-gate')
    expect(map.hotspots.map(item => item.id)).to.include.members([
      'main-seat',
      'agent-roster',
      'bounty-board',
      'library-shelf',
      'roster-book'
    ])
    expect(map.hotspots.find(item => item.id === 'main-seat')).to.include({
      panel: 'chat'
    })
    expect(map.hotspots.filter(item => item.type === 'prop').map(item => item.tileResourceName)).to.include.members([
      'hall-props-tile-0',
      'hall-props-tile-1',
      'hall-props-tile-2',
      'hall-props-tile-3',
      'hall-props-tile-4'
    ])
    expect(map.obstacles).to.have.length.greaterThan(0)
    expect(map.obstacles[0]).to.include.keys(['rect', 'x', 'y', 'w', 'h'])
  })

  it('normalizes Tiled rectangles against image coordinate space', () => {
    const rect = rectToPercent({ x: 836, y: 470.5, width: 167.2, height: 94.1 }, { width: 1672, height: 941 })

    expect(rect.x).to.equal(55)
    expect(rect.y).to.equal(55)
    expect(rect.w).to.equal(10)
    expect(rect.h).to.equal(10)
  })

  it('parses melonJS loader TMX objects without relying on raw XML', () => {
    const map = parseJuyiHallTmx({
      width: 30,
      height: 20,
      tilewidth: 32,
      tileheight: 32,
      layers: [
        { id: '1', name: 'background', type: 'imagelayer', image: 'images/liangshan-hall-bg-v2.png' },
        {
          id: '2',
          name: 'hotspots',
          type: 'objectgroup',
          objects: [
            { id: '10', name: 'mainSeat', x: '394', y: '293', width: '173', height: '106', properties: { panel: 'chat' } }
          ]
        },
        {
          id: '4',
          name: 'spawns',
          type: 'objectgroup',
          objects: [
            { id: '70', name: 'spawn_songjiang', x: '480', y: '403', width: '16', height: '16' }
          ]
        },
        { id: '5', name: 'foreground', type: 'imagelayer', image: 'images/liangshan-hall-foreground-v1.png' }
      ]
    })

    expect(map.imageLayers.background.source).to.equal('/juyiting/images/liangshan-hall-bg-v2.png')
    expect(map.hotspots[0]).to.include({ id: 'mainSeat', panel: 'chat' })
  })

  it('keeps hall tile-layer coordinates aligned to the map art bounds', () => {
    const map = parseJuyiHallTmx(hallV4Xml)

    expect(map.width).to.equal(1664)
    expect(map.height).to.equal(928)
    expect(map.coordinateWidth).to.equal(1664)
    expect(map.coordinateHeight).to.equal(928)
    expect(map.tileLayers.find(layer => layer.name === 'background')).to.include({
      width: 104,
      height: 58
    })
    expect(map.tileLayers.find(layer => layer.name === 'background').data).to.have.length(104 * 58)
    expect(map.imageLayers).not.to.have.property('prop-gate')

    const mainSeat = map.hotspots.find(item => item.id === 'main-seat')
    expect(mainSeat.rect).to.include({
      x: 818,
      y: 175,
      width: 108,
      height: 92
    })
    expect(mainSeat).to.include({
      panel: 'chat',
      shape: 'polygon'
    })
  })

  it('preserves melonJS parsed typed-array tile data for hall background', () => {
    const doc = new DOMParser().parseFromString(hallV4Xml, 'application/xml')
    const melonMap = TMXUtils.parse(doc).map
    const map = parseJuyiHallTmx(melonMap)
    const background = map.tileLayers.find(layer => layer.name === 'background')

    expect(background).to.include({
      width: '104',
      height: '58'
    })
    expect(background.data).to.be.instanceOf(Uint32Array)
    expect(background.data).to.have.length(104 * 58)
    expect(background.data[0]).to.equal(1)
    expect(background.data[background.data.length - 1]).to.equal(6032)
  })
})
