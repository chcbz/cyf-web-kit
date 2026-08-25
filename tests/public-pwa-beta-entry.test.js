import { expect } from 'chai'
import { existsSync, readFileSync } from 'node:fs'
import { PNG } from 'pngjs'

import { guestDemoSteps, guestDemoTemplates } from '../src/constants/publicBetaDemo.js'

const source = (path) => readFileSync(path, 'utf8')
const publicFile = (url) => `public${new URL(url, 'https://juyiting.test').pathname}`

describe('public PWA beta entry packet', () => {
  it('serves a landing page at root and keeps the real Juyi Hall route intact', () => {
    const router = source('src/router/index.js')

    expect(router).to.include("path: '/',")
    expect(router).to.include("name: 'PublicLanding'")
    expect(router).to.include("import PublicLanding from '@/components/public/PublicLanding.vue'")
    expect(router).to.include("path: '/demo'")
    expect(router).to.include("name: 'GuestDemo'")
    expect(router).to.include("import GuestDemo from '@/components/public/GuestDemo.vue'")
    expect(router).to.include('component: PublicLanding')
    expect(router).to.include('component: GuestDemo')
    expect(router).not.to.include("import('@/components/public/")
    expect(router).to.include("path: '/juyiting'")
    expect(router).to.include("name: 'JuyiHall'")
    expect(router).to.include("@/components/world/JuyiHallEntry.vue")
    expect(router).not.to.include("component: () => import('@/components/world/JuyiHall'),")
    expect(router).not.to.include("redirect: '/juyiting'")

    const entry = source('src/components/world/JuyiHallEntry.vue')
    expect(entry).to.include('<JuyiHall />')
    expect(entry).to.include("router.replace({ path: route.path, query: handoff.query, hash: route.hash })")
  })

  it('keeps the guest demo local and excludes app-shell API work on public routes', () => {
    const demo = source('src/components/public/GuestDemo.vue')
    const landing = source('src/components/public/PublicLanding.vue')
    const app = source('src/App.vue')
    const index = source('index.html')
    const main = source('src/main.js')
    const worker = source('public/sw.js')

    expect(guestDemoTemplates.map(template => template.id)).to.deep.equal(['research', 'content', 'collaboration'])
    expect(guestDemoSteps.map(step => step.id)).to.deep.equal([1, 2, 3, 4])
    expect(demo).to.include('全程本地模拟')
    expect(demo).to.include("new Set(['research', 'content', 'collaboration'])")
    expect(demo).to.include('allowedGuestDemoTemplateIds.has(id)')
    expect(demo).to.include('不会发起登录、授权或受保护的 API 请求')
    expect(demo).not.to.match(/useHttp|agentApi|chatApi|useApiStore|fetch\s*\(|axios|XMLHttpRequest/)
    expect(app).to.include('route.meta?.publicEntry === true')
    expect(app).to.include("defineAsyncComponent(() => import('@/components/SideMenu'))")
    expect(app).to.include('<side-menu v-if="!isPublicEntry"')
    expect(app).to.include('v-if="showAppBar && !isPublicEntry"')
    expect(app).to.include('.app-content.public-entry > *')
    expect(app).to.include('min-width: 0;')
    expect(demo).to.include('box-sizing: border-box;')
    expect(demo).to.include('max-width: 100%;')
    expect(demo).to.include('flex-wrap: wrap;')
    expect(demo).to.include('repeat(3, minmax(0, 1fr))')
    expect(demo).to.include('overflow-wrap: anywhere;')
    expect(demo).to.include(":aria-current=\"currentStep === step.id ? 'step' : undefined\"")
    expect(demo).to.include(':aria-pressed="selectedTemplate.id === template.id"')
    expect(demo).not.to.include('#49866e')
    expect(demo).not.to.include('#78817c')
    expect(demo).to.include('#2e6854')
    expect(demo).to.include('#59645e')
    expect(landing).not.to.match(/#49866e|<br/)
    expect(landing).to.include('.section-heading .eyebrow {\n  color: #2e6854;\n}')
    expect(landing).to.include('.landing-cta .eyebrow {\n  color: #c9ddbd;\n}')
    expect(index).to.include('<meta name="theme-color" content="#173936">')
    expect(main).to.include('router.isReady().then(() => {')
    expect(main.indexOf('router.isReady().then(() => {')).to.be.lessThan(main.indexOf("app.mount('#app')"))
    expect(worker).to.include("const APP_SHELL = ['/', '/demo', '/index.html', '/manifest.webmanifest']")
  })

  it('references only real manifest assets and provides install shortcuts with store-ready screenshots', () => {
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
    expect(manifest.screenshots.map(screenshot => screenshot.form_factor)).to.deep.equal(['wide', 'narrow'])
    expect(manifest.screenshots.map(screenshot => screenshot.sizes)).to.deep.equal(['1280x720', '750x1334'])
    referencedAssets.forEach(asset => expect(existsSync(publicFile(asset)), asset).to.equal(true))

    manifest.screenshots.forEach(screenshot => {
      const image = PNG.sync.read(readFileSync(publicFile(screenshot.src)))
      expect(`${image.width}x${image.height}`, screenshot.src).to.equal(screenshot.sizes)
    })
  })

  it('publishes canonical search and social metadata for the public entry', () => {
    const index = source('index.html')
    const robots = source('public/robots.txt')
    const sitemap = source('public/sitemap.xml')

    expect(index).to.include('<html lang="zh-CN">')
    expect(index).to.include('<meta name="description"')
    expect(index).to.include('<link rel="canonical" href="https://kit.chaoyoufan.cn/">')
    expect(index).to.include('<meta property="og:image" content="https://kit.chaoyoufan.cn/pwa/og-juyiting-1200x630.png">')
    expect(index).to.include('<meta name="twitter:card" content="summary_large_image">')
    expect(index).to.include('<meta name="twitter:image:alt" content="聚义厅 AI Agent 协作台首页">')
    expect(index).to.include('<meta property="og:image:width" content="1200">')
    expect(index).to.include('<meta property="og:image:height" content="630">')
    expect(existsSync('public/pwa/og-juyiting-1200x630.png')).to.equal(true)
    const socialImage = PNG.sync.read(readFileSync('public/pwa/og-juyiting-1200x630.png'))
    expect(`${socialImage.width}x${socialImage.height}`).to.equal('1200x630')
    expect(robots).to.include('Sitemap: https://kit.chaoyoufan.cn/sitemap.xml')
    expect(robots).to.include('Disallow: /oauth2/')
    expect(robots).to.include('Disallow: /juyiting')
    expect(sitemap).to.include('<loc>https://kit.chaoyoufan.cn/</loc>')
    expect(sitemap).not.to.include('<loc>https://kit.chaoyoufan.cn/demo</loc>')
  })

})
