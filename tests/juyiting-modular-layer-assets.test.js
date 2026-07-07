import { expect } from 'chai'
import { existsSync, readFileSync } from 'fs'

describe('Juyiting modular layer legacy assets', () => {
  it('does not keep a JS modular map layer manifest', () => {
    expect(existsSync('src/game/hallModularLayers.js')).to.equal(false)
  })

  it('keeps the visual preview free of the removed gate layer', () => {
    const source = readFileSync('public/juyiting/images/modular/preview.html', 'utf8')
    expect(source).not.to.include('prop-gate')
    expect(source).not.to.include('layer gate')
  })
})
