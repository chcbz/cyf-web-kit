import { expect } from 'chai'
import { existsSync, readFileSync } from 'fs'

import {
  HALL_MODULAR_ENVIRONMENT_LAYERS,
  HALL_MODULAR_PROP_LAYERS,
  HALL_MODULAR_RENDER_LAYERS,
  HALL_MODULAR_LAYER_RESOURCES
} from '../src/game/hallModularLayers.js'

const pngInfo = (path) => {
  const bytes = readFileSync(path)
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes.readUInt8(25)
  }
}

describe('Juyiting modular layer assets', () => {
  it('declares the generated modular environment layers', () => {
    expect(HALL_MODULAR_ENVIRONMENT_LAYERS.map(layer => layer.id)).to.deep.equal(['hall-wall-back', 'hall-floor'])

    HALL_MODULAR_ENVIRONMENT_LAYERS.forEach(layer => {
      expect(layer.kind).to.equal('environment')
      expect(layer.src).to.match(/^\/juyiting\/images\/modular\/.+\.png$/)
      expect(layer.defaultScale).to.be.a('number').and.greaterThan(0)
    })
  })

  it('declares the generated modular prop layers', () => {
    expect(HALL_MODULAR_PROP_LAYERS.map(layer => layer.id)).to.deep.equal([
      'prop-main-seat',
      'prop-table-desk',
      'prop-bounty-board',
      'prop-library-shelf',
      'prop-roster-book',
      'prop-gate'
    ])

    HALL_MODULAR_PROP_LAYERS.forEach(layer => {
      expect(layer.kind).to.equal('prop')
      expect(layer.src).to.match(/^\/juyiting\/images\/modular\/.+\.png$/)
      expect(layer.depth).to.be.a('number')
      expect(layer.defaultX).to.be.a('number')
      expect(layer.defaultY).to.be.a('number')
      expect(layer.defaultScale).to.be.a('number').and.greaterThan(0)
    })
  })

  it('sorts render layers by depth', () => {
    const depths = HALL_MODULAR_RENDER_LAYERS.map(layer => layer.depth)
    expect(depths).to.deep.equal([...depths].sort((a, b) => a - b))
  })

  it('exposes every modular layer as an image resource', () => {
    const layerResourceNames = HALL_MODULAR_RENDER_LAYERS.map(layer => layer.resourceName)
    expect(HALL_MODULAR_LAYER_RESOURCES.map(resource => resource.name)).to.deep.equal(layerResourceNames)
    HALL_MODULAR_LAYER_RESOURCES.forEach(resource => {
      expect(resource.type).to.equal('image')
      expect(resource.src).to.match(/^\/juyiting\/images\/modular\/.+\.png$/)
    })
  })

  it('points every manifest entry at an existing PNG', () => {
    HALL_MODULAR_RENDER_LAYERS.forEach(layer => {
      const filePath = layer.src.replace('/juyiting/', 'public/juyiting/')
      expect(existsSync(filePath), layer.id).to.equal(true)
      const info = pngInfo(filePath)
      expect(info.width, layer.id).to.be.greaterThan(64)
      expect(info.height, layer.id).to.be.greaterThan(64)
    })
  })

  it('keeps prop assets alpha-capable', () => {
    HALL_MODULAR_PROP_LAYERS.forEach(layer => {
      const filePath = layer.src.replace('/juyiting/', 'public/juyiting/')
      const info = pngInfo(filePath)
      expect([4, 6], layer.id).to.include(info.colorType)
    })
  })
})

