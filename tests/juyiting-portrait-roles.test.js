import { existsSync, readFileSync } from 'fs'
import { expect } from 'chai'
import {
  bodyTypeByMotif,
  hallScale,
  portraitRoles,
  roleBodyVisuals
} from '../src/constants/juyiting.js'

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
    expect(portraitSource).not.to.include('juyiting/portraits')
  })

  it('uses realistic PNG portraits for the default visible prototypes', () => {
    expect(portraitSource).to.include('const realisticPortraits = new Map')
    expect(portraitSource).to.include('const realisticAtlasPortraits = new Map')
    expect(portraitSource).to.include('backgroundSize: \'200% 200%\'')
    expect(portraitSource).to.include('songjiang-realistic.png')
    expect(portraitSource).to.include('water-margin-atlas-')
    expect(portraitSource).to.include('staticPortrait(role)')
    expect(portraitRoles.find(role => role.slug === 'songjiang').title).to.equal('及时雨')
    expect(portraitRoles.find(role => role.slug === 'wuyong').title).to.equal('智多星')
    expect(portraitRoles.find(role => role.slug === 'husanniang').title).to.equal('一丈青')
  })

  it('keeps single realistic portrait assets available and referenced by default', () => {
    for (const filename of [
      'songjiang-realistic.png',
      'wuyong-realistic.png',
      'wusong-realistic.png',
      'husanniang-realistic.png'
    ]) {
      expect(existsSync(new URL(`../public/juyiting-portraits/${filename}`, import.meta.url))).to.equal(true)
    }
  })

  it('keeps all realistic atlas portrait assets available for the 104 non-single roles', () => {
    for (let index = 1; index <= 26; index += 1) {
      const filename = `water-margin-atlas-${String(index).padStart(3, '0')}.png`
      expect(existsSync(new URL(`../public/juyiting-portraits/${filename}`, import.meta.url))).to.equal(true)
    }

    const atlasRoleCount = portraitRoles.filter(role => ![
      'songjiang',
      'wuyong',
      'wusong',
      'husanniang'
    ].includes(role.slug)).length
    expect(atlasRoleCount).to.equal(104)
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

  it('maps every role motif to a realistic full-body atlas posture', () => {
    const visualKeys = new Set(Object.keys(roleBodyVisuals))

    for (const motif of new Set(portraitRoles.map(role => role.motif))) {
      expect(bodyTypeByMotif[motif], `missing body type for motif ${motif}`).to.be.a('string')
      expect(visualKeys.has(bodyTypeByMotif[motif]), `missing visual for motif ${motif}`).to.equal(true)
    }

    for (const role of portraitRoles) {
      expect(visualKeys.has(role.bodyType), `missing body visual for ${role.slug}`).to.equal(true)
      expect(role.stance).to.be.within(0.1, 0.45)
      expect(role.gaitWeight).to.be.within(0.6, 1.2)
      expect(role.propType).to.be.a('string')
    }
  })

  it('keeps full-body atlas and hall scale proportions physically plausible', () => {
    expect(hallScale.personHeightPct).to.be.within(9, 13)
    expect(hallScale.personFootprintPct.width / hallScale.personHeightPct).to.be.within(0.2, 0.3)
    expect(hallScale.personFootprintPct.height / hallScale.personHeightPct).to.be.within(0.08, 0.12)
    expect(hallScale.depthScaleMin).to.be.lessThan(1)
    expect(hallScale.depthScaleMax).to.be.greaterThan(1)

    expect(hallScale.propRatios.mainTable).to.be.within(0.4, 0.5)
    expect(hallScale.propRatios.bookcase).to.be.within(1.35, 1.5)
    expect(hallScale.propRatios.bountyRack).to.be.within(1.05, 1.15)
    expect(hallScale.propRatios.recruitDrum).to.be.within(0.6, 0.7)
    expect(hallScale.propRatios.weaponRack).to.be.within(1.25, 1.4)
    expect(hallScale.propRatios.pillarDiameter).to.be.within(0.22, 0.28)

    for (const visual of Object.values(roleBodyVisuals)) {
      expect(visual.column).to.be.within(0, 2)
      expect(visual.row).to.be.within(0, 2)
      expect(visual.width).to.be.within(0.54, 0.74)
      expect(visual.height).to.be.within(0.98, 1.05)
      expect(visual.headScale).to.be.within(0.84, 0.95)
      expect(visual.shoulderWidth).to.be.within(0.27, 0.38)
    }
  })
})
