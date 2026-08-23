import { expect } from 'chai'
import { readFileSync } from 'node:fs'

describe('OAuth route integration', () => {
  it('uses the real callback component while preserving public and Juyi Hall routes', () => {
    const router = readFileSync('src/router/index.js', 'utf8')
    expect(router).to.include("import OAuthCallback from '@/components/OAuthCallback.vue'")
    expect(router).to.include("path: '/oauth2/callback'")
    expect(router).to.include('component: OAuthCallback')
    expect(router).not.to.include('to.query.state')
    expect(router).to.include("path: '/'")
    expect(router).to.include("path: '/demo'")
    expect(router).to.include("path: '/juyiting'")
  })
})
