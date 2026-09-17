import { expect } from 'chai'
import { createMemoryHistory, createRouter } from 'vue-router'
import {
  ECONOMY_PREVIEW_ROUTE,
  JUYI_HALL_ROUTE,
  PROFILE_ROUTE,
  openEconomyPreview,
  previewFailureFromRoute,
  previewFailureMessage,
  profilePreviewFailureTarget,
  returnToJuyiHall,
  returnToProfile
} from '../src/utils/profileNavigation.js'

global.history = global.window?.history

const routes = [
  { path: '/profile', name: PROFILE_ROUTE, component: { template: '<div />' } },
  { path: '/economy-preview', name: ECONOMY_PREVIEW_ROUTE, component: { template: '<div />' } },
  { path: '/juyiting', name: JUYI_HALL_ROUTE, component: { template: '<div />' } }
]

const routerAt = async path => {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  return router
}

describe('profile navigation contract', () => {
  it('uses named fixed internal destinations with push for entry and replace for explicit returns', async () => {
    const router = await routerAt('/juyiting')
    await openEconomyPreview(router)
    expect(router.currentRoute.value.name).to.equal(ECONOMY_PREVIEW_ROUTE)

    await returnToProfile(router)
    expect(router.currentRoute.value.name).to.equal(PROFILE_ROUTE)
    await returnToJuyiHall(router)
    expect(router.currentRoute.value.name).to.equal(JUYI_HALL_ROUTE)
  })

  it('allows only fixed, non-sensitive preview failure reasons through a guard redirect', () => {
    expect(profilePreviewFailureTarget('PREVIEW_DISABLED')).to.deep.equal({
      name: PROFILE_ROUTE,
      query: { preview: 'disabled' }
    })
    expect(profilePreviewFailureTarget('CAPABILITIES_MALFORMED')).to.deep.equal({
      name: PROFILE_ROUTE,
      query: { preview: 'unavailable' }
    })
    expect(previewFailureFromRoute({ query: { preview: 'disabled', returnUrl: 'https://example.invalid' } })).to.equal('disabled')
    expect(previewFailureFromRoute({ query: { preview: 'token-value' } })).to.equal('')
    expect(previewFailureMessage('disabled')).to.not.include('token')
    expect(previewFailureMessage('PREVIEW_DISABLED')).to.include('当前未开放')
    expect(previewFailureMessage('PREVIEW_DISABLED')).to.not.include('未读取')
  })
})
