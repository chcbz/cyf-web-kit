import { expect } from 'chai'
import { readFileSync } from 'fs'

describe('PWA service worker localhost contract', () => {
  it('unregisters itself on localhost development origins', () => {
    const source = readFileSync('public/sw.js', 'utf8')

    expect(source).to.include('isDevelopmentOrigin')
    expect(source).to.include('self.registration.unregister')
  })
})
