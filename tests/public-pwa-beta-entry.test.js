import { expect } from 'chai'
import { existsSync, readFileSync } from 'node:fs'

import { guestDemoSteps, guestDemoTemplates } from '../src/constants/publicBetaDemo.js'

const source = (path) => readFileSync(path, 'utf8')
const publicFile = (url) => `public${new URL(url, 'https://juyiting.test').pathname}`

describe('public PWA beta entry packet', () => {
  it('serves a landing page at root and keeps the real Juyi Hall route intact', () => {
    const router = source('src/router/index.js')

    expect(router).to.include("path: '/',")
    expect(router).to.include("name: 'PublicLanding'")
    expect(router).to.include("@/components/public/PublicLanding")
    expect(router).to.include("path: '/demo'")
    expect(router).to.include("name: 'GuestDemo'")
    expect(router).to.include("path: '/juyiting'")
    expect(router).to.include("name: 'JuyiHall'")
    expect(router).to.include("@/components/world/JuyiHall")
    expect(router).not.to.include("redirect: '/juyiting'")
  })

  it('keeps the guest demo local and excludes app-shell API work on public routes', () => {
    const demo = source('src/components/public/GuestDemo.vue')
    const app = source('src/App.vue')

    expect(guestDemoTemplates.map(template => template.id)).to.deep.equal(['research', 'content', 'collaboration'])
    expect(guestDemoSteps.map(step => step.id)).to.deep.equal([1, 2, 3, 4])
    expect(demo).to.include('全程本地模拟')
    expect(demo).to.include('不会发起登录、授权或受保护的 API 请求')
    expect(demo).not.to.match(/useHttp|agentApi|chatApi|useApiStore|fetch\s*\(|axios|XMLHttpRequest/)
    expect(app).to.include('route.meta?.publicEntry === true')
    expect(app).to.include("defineAsyncComponent(() => import('@/components/SideMenu'))")
    expect(app).to.include('<side-menu v-if="!isPublicEntry"')
    expect(app).to.include('v-if="showAppBar && !isPublicEntry"')
  })

  it('references only real manifest assets and provides install shortcuts without screenshots', () => {
    const manifest = JSON.parse(source('public/manifest.webmanifest'))
    const referencedAssets = [
      ...manifest.icons.map(icon => icon.src),
      ...manifest.shortcuts.flatMap(shortcut => (shortcut.icons || []).map(icon => icon.src)),
      ...(manifest.screenshots || []).map(screenshot => screenshot.src)
    ]

    expect(manifest.start_url).to.equal('/')
    expect(manifest.orientation).to.equal('any')
    expect(manifest.categories).to.include.members(['productivity', 'business'])
    expect(manifest.shortcuts.map(shortcut => shortcut.url)).to.deep.equal(['/demo', '/juyiting'])
    expect(manifest).not.to.have.property('screenshots')
    referencedAssets.forEach(asset => expect(existsSync(publicFile(asset)), asset).to.equal(true))
  })
})
