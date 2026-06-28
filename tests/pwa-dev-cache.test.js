import { expect } from 'chai'
import { readFileSync } from 'fs'

describe('PWA development cache contract', () => {
  it('does not register a service worker during Vite development', () => {
    const source = readFileSync('src/utils/pwa.js', 'utf8')

    expect(source).to.include('import.meta.env.DEV')
    expect(source).to.match(/if\s*\(\s*import\.meta\.env\.DEV\s*\)/)
  })
})
