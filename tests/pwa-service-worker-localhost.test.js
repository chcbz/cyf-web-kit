import { expect } from 'chai'
import { readFileSync } from 'fs'

describe('PWA service worker localhost contract', () => {
  it('unregisters itself on localhost development origins', () => {
    const source = readFileSync('public/sw.js', 'utf8')

    expect(source).to.include('isDevelopmentOrigin')
    expect(source).to.include('self.registration.unregister')
    expect(source).to.include("const CACHE_VERSION = 'cyf-pwa-v20260918-hall-account-layout-r1'")
    expect(source).to.include('self.skipWaiting()')
    expect(source).to.include('self.clients.claim()')
  })
})
