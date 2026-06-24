import { existsSync, readFileSync } from 'fs'
import { expect } from 'chai'
import { portraitRoles } from '../src/constants/juyiting.js'

const portraitSource = readFileSync(
  new URL('../src/composables/juyiting/useWaterMarginRoles.js', import.meta.url),
  'utf8'
)

describe('JuyiHall portrait roles', () => {
  it('defines all 108 Water Margin prototypes with unique identity metadata', () => {
    expect(portraitRoles).to.have.length(108)
    expect(new Set(portraitRoles.map(role => role.slug))).to.have.length(108)
    expect(new Set(portraitRoles.map(role => role.rankNo))).to.have.length(108)
    expect(new Set(portraitRoles.map(role => `${role.starName}:${role.name}:${role.title}`))).to.have.length(108)
  })

  it('uses static per-role portraits and generated custom portraits instead of repeated sprite-grid cells', () => {
    expect(portraitSource).to.include("publicAsset(`juyiting-portraits/${role.slug}.svg`)")
    expect(portraitSource).to.include('const generatedPortrait = (role) =>')
    expect(portraitSource).to.include('data:image/svg+xml')
    expect(portraitSource).not.to.include('water-margin-agents')
    expect(portraitSource).not.to.include("backgroundSize: '300% 200%'")
  })

  it('has detailed specialty portraits for the default visible prototypes', () => {
    expect(portraitSource).to.include('const realisticPortraits = new Map')
    expect(portraitSource).to.include('songjiang-realistic.png')
    expect(portraitSource).to.include('wuyong-realistic.png')
    expect(portraitSource).to.include('wusong-realistic.png')
    expect(portraitSource).to.include('husanniang-realistic.png')
    expect(portraitRoles.find(role => role.slug === 'songjiang').title).to.equal('及时雨')
    expect(portraitRoles.find(role => role.slug === 'wuyong').title).to.equal('智多星')
    expect(portraitRoles.find(role => role.slug === 'husanniang').title).to.equal('一丈青')
  })

  it('keeps realistic portrait assets available for the current visible roles', () => {
    for (const filename of [
      'songjiang-realistic.png',
      'wuyong-realistic.png',
      'wusong-realistic.png',
      'husanniang-realistic.png'
    ]) {
      expect(existsSync(new URL(`../public/juyiting-portraits/${filename}`, import.meta.url))).to.equal(true)
    }
  })

  it('keeps one static SVG portrait asset for every Water Margin prototype', () => {
    for (const role of portraitRoles) {
      const source = readFileSync(new URL(`../public/juyiting-portraits/${role.slug}.svg`, import.meta.url), 'utf8')
      expect(source).to.include('<svg')
      expect(source).to.include(role.name)
      expect(source).to.include(`${role.rankNo}`)
    }
  })

  it('matches prefixed runtime ids before falling back to seeded portraits', () => {
    expect(portraitSource).to.include("replace(/^agent-/, '')")
    expect(portraitSource).to.include("replace(/^jyt-[^-]+-/, '')")
    expect(portraitSource).to.include('roleByCode(agent?.agentId)')
  })
})
