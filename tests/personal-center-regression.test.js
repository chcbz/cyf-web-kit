// Retain original account-security regression while changing its presentation.
import './composables/accountSecuritySession.spec.js'
import './composables/userProfileAccountSecurity.spec.js'
import { expect } from 'chai'
import { readFileSync } from 'node:fs'

describe('hall-styled personal center shell', () => {
  it('uses its own accessible header without the unrelated blue application bar', () => {
    const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
    const routes = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8')
    expect(app).to.include('!route.meta?.standaloneHeader')
    for (const route of ['/profile', '/wallet']) {
      const section = routes.slice(routes.indexOf(`path: '${route}'`)).split('  },')[0]
      expect(section).to.include('standaloneHeader: true')
      expect(section).not.to.include('publicEntry: true')
    }
    const profile = readFileSync(new URL('../src/components/UserProfile.vue', import.meta.url), 'utf8')
    expect(profile).to.include('返回聚义厅')
    expect(profile).to.include('profile-wallet')
    expect(profile).not.to.include('#4f46e5')
    expect(profile).to.include('#923f30')
    expect(profile).to.include('min-height: 44px')
  })
})
