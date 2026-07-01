import { expect } from 'chai'

import { HALL_SCENE_REGIONS } from '../src/constants/juyitingScene.js'
import { clampPointToAnyRegion, clampPointToRegion, isPointInPolygon } from '../src/game/walkableArea.js'

describe('Juyiting walkable area geometry', () => {
  it('keeps valid hall points inside their region polygon', () => {
    const point = { x: 50, y: 45 }
    const clamped = clampPointToRegion(point, HALL_SCENE_REGIONS.mainSeat)

    expect(clamped).to.deep.equal(point)
    expect(isPointInPolygon(clamped, HALL_SCENE_REGIONS.mainSeat.walkable)).to.equal(true)
  })

  it('moves out-of-bounds destinations to the nearest walkable edge', () => {
    const clamped = clampPointToRegion({ x: 95, y: 20 }, HALL_SCENE_REGIONS.bountyBoard)

    expect(clamped.x).to.be.within(69, 86)
    expect(clamped.y).to.be.within(52, 67)
    expect(isPointInPolygon(clamped, HALL_SCENE_REGIONS.bountyBoard.walkable)).to.equal(true)
  })

  it('can clamp arbitrary runtime destinations to the nearest hall region', () => {
    const clamped = clampPointToAnyRegion({ x: 3, y: 92 }, HALL_SCENE_REGIONS)

    expect(clamped.x).to.be.greaterThan(10)
    expect(clamped.y).to.be.lessThan(90)
    expect(Object.values(HALL_SCENE_REGIONS).some(region => (
      isPointInPolygon(clamped, region.walkable)
    ))).to.equal(true)
  })
})
