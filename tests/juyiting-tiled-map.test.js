import { expect } from 'chai'
import { readFileSync } from 'fs'

import { parseJuyiHallTmx, rectToPercent } from '../src/game/tiledMap.js'

describe('Juyi Hall Tiled map parser', () => {
  const xml = readFileSync(new URL('../public/juyiting/hall.tmx', import.meta.url), 'utf8')

  it('parses image layers, hotspots, obstacles, and spawn points from hall.tmx', () => {
    const map = parseJuyiHallTmx(xml)

    expect(map.width).to.equal(960)
    expect(map.height).to.equal(640)
    expect(map.coordinateWidth).to.equal(960)
    expect(map.coordinateHeight).to.be.greaterThan(860)
    expect(map.imageLayers.background.source).to.equal('/juyiting/images/liangshan-hall-bg-v2.png')
    expect(map.imageLayers.foreground.source).to.equal('/juyiting/images/liangshan-hall-foreground-v1.png')
    expect(map.hotspots.map(item => item.id)).to.include.members([
      'mainSeat',
      'agentRoster',
      'bountyBoard',
      'personaCatalog',
      'libraryShelf'
    ])
    expect(map.hotspots.find(item => item.id === 'mainSeat')).to.include({
      panel: 'chat'
    })
    expect(map.obstacles.map(item => item.id)).to.include('main-seat')
    expect(map.spawns.songjiang).to.include.keys(['x', 'y'])
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
    expect(map.spawns.songjiang).to.include.keys(['x', 'y'])
  })
})
