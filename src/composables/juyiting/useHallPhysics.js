import { ref } from 'vue'
import { hallObstacles, hallPatrolAnchors, hallPhysicalScene, hallScale, trainingRoomAnchor, walkBounds } from '@/constants/juyiting'
import { agentSeed, portraitRole } from '@/composables/juyiting/useWaterMarginRoles'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const randomFromSeed = (seed, offset = 0) => {
  const value = Math.sin((seed + 1) * 127.1 + offset * 311.7) * 43758.5453123
  return value - Math.floor(value)
}

const sampleRange = (seed, min, max, offset = 0) => min + (max - min) * randomFromSeed(seed, offset)

const insideRect = (point, obstacle, padding = 0) => (
  point.x >= obstacle.x - obstacle.w / 2 - padding &&
  point.x <= obstacle.x + obstacle.w / 2 + padding &&
  point.y >= obstacle.y - obstacle.h / 2 - padding &&
  point.y <= obstacle.y + obstacle.h / 2 + padding
)

const insideEllipse = (point, obstacle, padding = 0) => (
  Math.hypot(
    (point.x - obstacle.x) / (obstacle.rx + padding),
    (point.y - obstacle.y) / (obstacle.ry + padding)
  ) <= 1
)

const pointInObstacle = (point, obstacle, padding = 0) => (
  obstacle.type === 'rect'
    ? insideRect(point, obstacle, padding)
    : insideEllipse(point, obstacle, padding)
)

const pointInAnyObstacle = (point, padding = 0) => hallObstacles.some(obstacle => pointInObstacle(point, obstacle, padding))

const projectOutOfObstacle = (point, obstacle, padding = 0.75) => {
  if (!pointInObstacle(point, obstacle, padding)) return point
  if (obstacle.type === 'rect') {
    const halfW = obstacle.w / 2 + padding
    const halfH = obstacle.h / 2 + padding
    const dx = point.x - obstacle.x
    const dy = point.y - obstacle.y
    const pushX = halfW - Math.abs(dx)
    const pushY = halfH - Math.abs(dy)
    if (pushX < pushY) {
      return { x: obstacle.x + Math.sign(dx || 1) * halfW, y: point.y }
    }
    return { x: point.x, y: obstacle.y + Math.sign(dy || 1) * halfH }
  }

  const dx = point.x - obstacle.x
  const dy = point.y - obstacle.y
  const angle = Math.atan2(dy / obstacle.ry, dx / obstacle.rx)
  return {
    x: obstacle.x + Math.cos(angle) * (obstacle.rx + padding),
    y: obstacle.y + Math.sin(angle) * (obstacle.ry + padding)
  }
}

const keepWalkable = (point) => {
  let next = {
    x: clamp(point.x, walkBounds.minX, walkBounds.maxX),
    y: clamp(point.y, walkBounds.minY, walkBounds.maxY)
  }
  hallObstacles.forEach((obstacle) => {
    next = projectOutOfObstacle(next, obstacle)
    next.x = clamp(next.x, walkBounds.minX, walkBounds.maxX)
    next.y = clamp(next.y, walkBounds.minY, walkBounds.maxY)
  })
  return next
}

const createAnchorPoint = (anchor, seed, offset = 0) => keepWalkable({
  x: clamp(sampleRange(seed, anchor.x - anchor.radiusX, anchor.x + anchor.radiusX, offset), walkBounds.minX, walkBounds.maxX),
  y: clamp(sampleRange(seed, anchor.y - anchor.radiusY, anchor.y + anchor.radiusY, offset + 1), walkBounds.minY, walkBounds.maxY)
})

const limitVector = (vector, maxLength) => {
  const length = Math.hypot(vector.x, vector.y)
  if (!length || length <= maxLength) return vector
  const scale = maxLength / length
  return { x: vector.x * scale, y: vector.y * scale }
}

const segmentCrossesObstacle = (from, to, obstacle, padding = 0.7) => {
  const steps = Math.max(6, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 2))
  for (let index = 1; index < steps; index += 1) {
    const point = {
      x: from.x + (to.x - from.x) * (index / steps),
      y: from.y + (to.y - from.y) * (index / steps)
    }
    if (pointInObstacle(point, obstacle, padding)) return true
  }
  return false
}

const hasLineOfSight = (from, to) => !hallObstacles.some(obstacle => segmentCrossesObstacle(from, to, obstacle))

const planRoute = (from, to) => {
  const target = keepWalkable(to)
  if (hasLineOfSight(from, target)) return [target]

  const nodes = hallPhysicalScene.waypoints || []
  const usableNodes = nodes.filter(point => !pointInAnyObstacle(point, 0.8))
  const candidates = usableNodes
    .filter(point => hasLineOfSight(from, point) && hasLineOfSight(point, target))
    .map(point => ({
      point,
      score: Math.hypot(point.x - from.x, point.y - from.y) + Math.hypot(target.x - point.x, target.y - point.y)
    }))
    .sort((a, b) => a.score - b.score)

  if (candidates.length) return [candidates[0].point, target]

  const startNodes = usableNodes.filter(point => hasLineOfSight(from, point))
  const endNodes = usableNodes.filter(point => hasLineOfSight(point, target))
  let best = null
  startNodes.forEach((start) => {
    endNodes.forEach((end) => {
      if (!hasLineOfSight(start, end)) return
      const score = Math.hypot(start.x - from.x, start.y - from.y) +
        Math.hypot(end.x - start.x, end.y - start.y) +
        Math.hypot(target.x - end.x, target.y - end.y)
      if (!best || score < best.score) best = { start, end, score }
    })
  })

  if (best) return best.start === best.end ? [best.start, target] : [best.start, best.end, target]
  return [target]
}

export const useHallPhysics = (visibleAgents, normalizeStatus) => {
  const physicsFrame = ref(0)
  const agentPhysics = new Map()
  let physicsRaf = 0
  let lastPhysicsTime = 0

  const createPhysicsState = (agent) => {
    const seed = agentSeed(agent)
    const anchorCount = Math.min(5, hallPatrolAnchors.length)
    const startIndex = seed % hallPatrolAnchors.length
    const stride = 2 + (seed % 3)
    const anchorIndexes = Array.from({ length: anchorCount }, (_, index) => (
      (startIndex + index * stride) % hallPatrolAnchors.length
    ))
    const currentAnchorIndex = anchorIndexes[0]
    const currentAnchor = hallPatrolAnchors[currentAnchorIndex]
    const start = createAnchorPoint(currentAnchor, seed, 0)
    return {
      seed,
      anchorIndexes,
      currentAnchorIndex,
      targetAnchorIndex: currentAnchorIndex,
      target: start,
      x: start.x,
      y: start.y,
      vx: 0,
      vy: 0,
      route: [],
      face: randomFromSeed(seed, 2) >= 0.5 ? 1 : -1,
      speed: 0,
      restUntil: sampleRange(seed, 900, 2600, 3),
      travelCount: 0,
      isResting: true
    }
  }

  const physicsKey = (agent) => agent?.agentId || agent?.name || agent?.personaName || `${agentSeed(agent)}`

  const getPhysicsState = (agent) => {
    const key = physicsKey(agent)
    if (!agentPhysics.has(key)) {
      agentPhysics.set(key, createPhysicsState(agent))
    }
    return agentPhysics.get(key)
  }

  const syncPhysicsAgents = () => {
    const activeKeys = new Set(visibleAgents.value.map(physicsKey))
    for (const key of agentPhysics.keys()) {
      if (!activeKeys.has(key)) agentPhysics.delete(key)
    }
    visibleAgents.value.forEach(getPhysicsState)
  }

  const obstacleAvoidance = (state) => {
    return hallObstacles.reduce((force, obstacle) => {
      const dx = state.x - obstacle.x
      const dy = state.y - obstacle.y
      const rx = obstacle.type === 'rect' ? obstacle.w / 2 : obstacle.rx
      const ry = obstacle.type === 'rect' ? obstacle.h / 2 : obstacle.ry
      const normalized = Math.hypot(dx / rx, dy / ry)
      if (normalized >= 1.18) return force
      const falloff = (1.18 - Math.max(normalized, 0.08)) / 1.18
      const length = Math.hypot(dx, dy) || 1
      force.x += (dx / length) * falloff * obstacle.strength
      force.y += (dy / length) * falloff * obstacle.strength
      return force
    }, { x: 0, y: 0 })
  }

  const separationForce = (state, allStates) => {
    return allStates.reduce((force, other) => {
      if (other === state) return force
      const dx = state.x - other.x
      const dy = state.y - other.y
      const distance = Math.hypot(dx, dy) || 1
      if (distance > 8.5) return force
      const strength = (8.5 - distance) / 8.5
      force.x += (dx / distance) * strength * 1.8
      force.y += (dy / distance) * strength * 1.2
      return force
    }, { x: 0, y: 0 })
  }

  const chooseNextAnchor = (state, time) => {
    const options = state.anchorIndexes.filter(index => index !== state.currentAnchorIndex)
    const pool = options.length ? options : state.anchorIndexes
    const nextIndex = pool[Math.floor(randomFromSeed(state.seed, state.travelCount + time * 0.001) * pool.length)]
    const anchor = hallPatrolAnchors[nextIndex]
    state.targetAnchorIndex = nextIndex
    state.target = createAnchorPoint(anchor, state.seed, state.travelCount + 10)
    state.route = planRoute({ x: state.x, y: state.y }, state.target)
    state.travelCount += 1
    state.isResting = false
  }

  const placeInTrainingRoom = (state) => {
    const point = keepWalkable({
      x: clamp(sampleRange(state.seed, trainingRoomAnchor.x - trainingRoomAnchor.radiusX, trainingRoomAnchor.x + trainingRoomAnchor.radiusX, 31), walkBounds.minX, walkBounds.maxX),
      y: clamp(sampleRange(state.seed, trainingRoomAnchor.y - trainingRoomAnchor.radiusY, trainingRoomAnchor.y + trainingRoomAnchor.radiusY, 32), walkBounds.minY, walkBounds.maxY)
    })
    state.x = point.x
    state.y = point.y
    state.vx = 0
    state.vy = 0
    state.route = []
    state.speed = 0
    state.isResting = true
  }

  const startRest = (state, time, status) => {
    const anchor = hallPatrolAnchors[state.targetAnchorIndex]
    const [minLinger, maxLinger] = anchor.linger
    const lingerScale = status === 'busy' ? 0.72 : 1
    const linger = sampleRange(state.seed, minLinger, maxLinger, state.travelCount + 20) * lingerScale
    state.vx = 0
    state.vy = 0
    state.speed = 0
    state.restUntil = time + linger
    state.currentAnchorIndex = state.targetAnchorIndex
    state.isResting = true
  }

  const updatePhysics = (time) => {
    if (!lastPhysicsTime) lastPhysicsTime = time
    const dt = clamp((time - lastPhysicsTime) / 1000, 0.001, 0.05)
    lastPhysicsTime = time

    syncPhysicsAgents()
    const states = visibleAgents.value.map(getPhysicsState)
    states.forEach((state, index) => {
      const role = portraitRole(visibleAgents.value[index])
      const status = normalizeStatus(visibleAgents.value[index]?.status)
      if (status === 'busy') {
        placeInTrainingRoom(state)
        return
      }
      if (state.isResting) {
        state.vx = 0
        state.vy = 0
        state.speed = 0
        if (time >= state.restUntil) {
          chooseNextAnchor(state, time)
        }
        return
      }

      const routeTarget = state.route?.length ? state.route[0] : state.target
      const toTargetX = routeTarget.x - state.x
      const toTargetY = routeTarget.y - state.y
      const targetDistance = Math.hypot(toTargetX, toTargetY) || 1
      if (targetDistance < 1.35) {
        if (state.route?.length > 1) {
          state.route.shift()
          return
        }
        state.route = []
        startRest(state, time, status)
        return
      }

      const maxSpeed = (status === 'busy' ? 9.4 : 7.2) * (1.12 - (role.scale - 0.9) * 0.25)
      const desiredSpeed = targetDistance < 7 ? maxSpeed * 0.46 : maxSpeed
      const desired = {
        x: (toTargetX / targetDistance) * desiredSpeed,
        y: (toTargetY / targetDistance) * desiredSpeed
      }
      const avoid = obstacleAvoidance(state)
      const separate = separationForce(state, states)
      const steering = limitVector({
        x: (desired.x - state.vx) * 1.5 + avoid.x + separate.x,
        y: (desired.y - state.vy) * 1.5 + avoid.y + separate.y
      }, 9.5)

      state.vx += steering.x * dt
      state.vy += steering.y * dt
      const velocity = limitVector({ x: state.vx, y: state.vy }, maxSpeed)
      state.vx = velocity.x * 0.982
      state.vy = velocity.y * 0.982
      const nextPoint = keepWalkable({
        x: clamp(state.x + state.vx * dt, walkBounds.minX, walkBounds.maxX),
        y: clamp(state.y + state.vy * dt, walkBounds.minY, walkBounds.maxY)
      })
      state.x = nextPoint.x
      state.y = nextPoint.y
      state.speed = Math.hypot(state.vx, state.vy)
      if (Math.abs(state.vx) > 0.08) state.face = state.vx > 0 ? 1 : -1
    })

    physicsFrame.value += 1
    physicsRaf = requestAnimationFrame(updatePhysics)
  }

  const startPhysics = () => {
    if (physicsRaf) return
    lastPhysicsTime = 0
    physicsRaf = requestAnimationFrame(updatePhysics)
  }

  const stopPhysics = () => {
    if (!physicsRaf) return
    cancelAnimationFrame(physicsRaf)
    physicsRaf = 0
  }

  const agentStyle = (agent) => {
    physicsFrame.value
    const state = getPhysicsState(agent)
    const role = portraitRole(agent)
    const isMoving = state.speed > 0.18 && !state.isResting
    const walkActivity = isMoving ? clamp(state.speed / 7, 0.25, 1) : 0
    const depthProgress = clamp(
      (state.y - hallScale.depthReference.minY) / (hallScale.depthReference.maxY - hallScale.depthReference.minY),
      0,
      1
    )
    const depthScale = hallScale.depthScaleMin + (hallScale.depthScaleMax - hallScale.depthScaleMin) * depthProgress
    const gaitWeight = role.gaitWeight || 1
    return {
      left: `${state.x}%`,
      top: `${state.y}%`,
      zIndex: 4 + Math.round(state.y / 6),
      '--face': state.face,
      '--robe-color': role.robe,
      '--trim-color': role.trim,
      '--body-scale': role.scale,
      '--depth-scale': depthScale.toFixed(3),
      '--person-height-pct': hallScale.personHeightPct,
      '--footprint-width-pct': hallScale.personFootprintPct.width,
      '--footprint-height-pct': hallScale.personFootprintPct.height,
      '--gait-weight': gaitWeight,
      '--stance': role.stance || 0.2,
      '--step-speed': `${clamp((role.step * gaitWeight) / Math.max(walkActivity, 0.35), 0.52, 1.28)}s`,
      '--idle-speed': `${clamp(role.step * 3.8, 2.25, 3.8)}s`,
      '--step-lift': `${isMoving ? 1 + walkActivity * 2 : 0}px`,
      '--shadow-scale': isMoving ? 0.88 + walkActivity * 0.16 : 0.88,
      '--walk-play-state': isMoving ? 'running' : 'paused'
    }
  }

  return {
    agentStyle,
    startPhysics,
    stopPhysics
  }
}
