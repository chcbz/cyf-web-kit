import { existsSync, readFileSync } from 'fs'
import { expect } from 'chai'
import * as juyitingConstants from '../src/constants/juyiting.js'

const {
  bodyPartAnatomy,
  bodyTypeByMotif,
  hallPhysicalScene,
  hallScale,
  portraitRoles,
  roleBodyPartProfiles,
  roleBodyVisuals
} = juyitingConstants

const portraitSource = readFileSync(
  new URL('../src/composables/juyiting/useWaterMarginRoles.js', import.meta.url),
  'utf8'
)
const agentTokenSource = readFileSync(
  new URL('../src/components/juyiting/AgentToken.vue', import.meta.url),
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

  it('maps every role motif to a realistic articulated body posture', () => {
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

  it('keeps articulated body metadata and hall scale proportions physically plausible', () => {
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
    expect(bodyPartAnatomy.anchor).to.equal('feet-center')
    expect(bodyPartAnatomy.proportions.head.height[0]).to.be.greaterThan(0.13)
    expect(bodyPartAnatomy.proportions.foot.width[1]).to.be.lessThan(0.18)

    for (const visual of Object.values(roleBodyVisuals)) {
      expect(visual.width).to.be.within(0.54, 0.74)
      expect(visual.height).to.be.within(0.98, 1.05)
      expect(visual.headScale).to.be.within(0.84, 0.95)
      expect(visual.shoulderWidth).to.be.within(0.27, 0.38)
    }
  })

  it('defines articulated body rigs for every realistic body type', () => {
    const requiredParts = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'leftFoot', 'rightFoot', 'prop']
    const roleBodyRigs = juyitingConstants.roleBodyRigs

    expect(roleBodyRigs).to.be.an('object')

    for (const bodyType of Object.keys(roleBodyVisuals)) {
      const rig = roleBodyRigs[bodyType]
      expect(rig, `missing rig for ${bodyType}`).to.be.an('object')
      for (const part of requiredParts) {
        expect(rig[part], `missing ${part} rig for ${bodyType}`).to.be.an('object')
      }
      expect(rig.torso.tilt).to.be.within(-8, 8)
      expect(rig.leftArm.swing).to.be.within(4, 26)
      expect(rig.rightArm.swing).to.be.within(4, 26)
      expect(rig.leftLeg.stride).to.be.within(4, 24)
      expect(rig.rightLeg.stride).to.be.within(4, 24)
      expect(rig.prop.swing).to.be.within(0, 22)
    }
  })

  it('defines realistic body part profiles for every body type', () => {
    const requiredParts = ['head', 'neck', 'shoulder', 'torso', 'arm', 'leg', 'prop']
    expect(roleBodyPartProfiles).to.be.an('object')

    for (const bodyType of Object.keys(roleBodyVisuals)) {
      const profile = roleBodyPartProfiles[bodyType]
      expect(profile, `missing body part profile for ${bodyType}`).to.be.an('object')
      for (const part of requiredParts) {
        expect(profile[part], `missing ${part} profile for ${bodyType}`).to.be.an('object')
      }
      expect(profile.head.height).to.be.within(18, 20)
      expect(profile.torso.chest).to.be.within(0.9, 1.18)
      expect(profile.arm.hand).to.be.within(9, 12)
      expect(profile.leg.foot).to.be.within(13, 17)
    }
  })

  it('renders agent bodies from articulated body metadata instead of a full-body background atlas', () => {
    expect(agentTokenSource).to.include('roleBodyRigs')
    expect(agentTokenSource).to.include('roleBodyPartProfiles')
    expect(agentTokenSource).to.include('rigStyle')
    expect(agentTokenSource).to.include('agent-rig-part')
    expect(agentTokenSource).to.include('--part-head-width')
    expect(agentTokenSource).to.include('--left-arm-swing')
    expect(agentTokenSource).to.include('--left-leg-stride')
    expect(agentTokenSource).to.include('--prop-anchor-x')
    expect(agentTokenSource).not.to.include('characterBodyAtlas')
    expect(agentTokenSource).not.to.include('agent-body-sprite')
  })

  it('keeps the physical hall scene walkable and wired to known panels', () => {
    const validPanels = new Set(['chat', 'agents', 'catalog', 'tasks', 'library', null])
    const obstacleKeys = new Set()
    const insideObstacle = (point, obstacle, padding = 0) => {
      if (obstacle.type === 'rect') {
        return point.x >= obstacle.x - obstacle.w / 2 - padding &&
          point.x <= obstacle.x + obstacle.w / 2 + padding &&
          point.y >= obstacle.y - obstacle.h / 2 - padding &&
          point.y <= obstacle.y + obstacle.h / 2 + padding
      }
      return Math.hypot(
        (point.x - obstacle.x) / (obstacle.rx + padding),
        (point.y - obstacle.y) / (obstacle.ry + padding)
      ) <= 1
    }

    for (const zone of hallPhysicalScene.interactiveZones) {
      expect(validPanels.has(zone.panel), `bad panel ${zone.panel}`).to.equal(true)
      expect(zone.w).to.be.greaterThan(0)
      expect(zone.h).to.be.greaterThan(0)
    }

    for (const obstacle of hallPhysicalScene.solidObstacles) {
      expect(obstacleKeys.has(obstacle.key), `duplicate obstacle ${obstacle.key}`).to.equal(false)
      obstacleKeys.add(obstacle.key)
      expect(obstacle.heightRatio).to.be.within(0.4, 2.1)
    }

    const walkablePoints = [
      ...hallPhysicalScene.patrolAnchors.map(anchor => ({ x: anchor.x, y: anchor.y })),
      hallPhysicalScene.trainingAnchor,
      ...hallPhysicalScene.waypoints
    ]

    for (const point of walkablePoints) {
      expect(point.x).to.be.within(hallPhysicalScene.walkBounds.minX, hallPhysicalScene.walkBounds.maxX)
      expect(point.y).to.be.within(hallPhysicalScene.walkBounds.minY, hallPhysicalScene.walkBounds.maxY)
      for (const obstacle of hallPhysicalScene.solidObstacles) {
        expect(insideObstacle(point, obstacle, 0.7), `point ${point.x},${point.y} inside ${obstacle.key}`).to.equal(false)
      }
    }
  })
})
