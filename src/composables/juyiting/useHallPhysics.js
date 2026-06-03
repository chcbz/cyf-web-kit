import { ref } from 'vue'
import { hallObstacles, hallRoutes, walkBounds } from '@/constants/juyiting'
import { agentSeed, portraitRole } from '@/composables/juyiting/useWaterMarginRoles'

const routePoint = (route, index, seed) => {
  const [x, y] = route[index % route.length]
  const jitterX = ((seed + index * 7) % 7) - 3
  const jitterY = ((seed + index * 5) % 5) - 2
  return {
    x: Math.min(90, Math.max(10, x + jitterX)),
    y: Math.min(82, Math.max(22, y + jitterY))
  }
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const limitVector = (vector, maxLength) => {
  const length = Math.hypot(vector.x, vector.y)
  if (!length || length <= maxLength) return vector
  const scale = maxLength / length
  return { x: vector.x * scale, y: vector.y * scale }
}

export const useHallPhysics = (visibleAgents, normalizeStatus) => {
  const physicsFrame = ref(0)
  const agentPhysics = new Map()
  let physicsRaf = 0
  let lastPhysicsTime = 0

  const createPhysicsState = (agent) => {
    const seed = agentSeed(agent)
    const route = hallRoutes[seed % hallRoutes.length]
    const startOffset = seed % route.length
    const points = Array.from({ length: 8 }, (_, index) => routePoint(route, startOffset + index, seed))
    const start = points[0]
    return {
      seed,
      points,
      targetIndex: 1,
      x: start.x,
      y: start.y,
      vx: (((seed % 5) - 2) * 0.02),
      vy: (((seed % 7) - 3) * 0.015),
      face: points[1].x >= start.x ? 1 : -1,
      speed: 0
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
      const normalized = Math.hypot(dx / obstacle.rx, dy / obstacle.ry)
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

  const updatePhysics = (time) => {
    if (!lastPhysicsTime) lastPhysicsTime = time
    const dt = clamp((time - lastPhysicsTime) / 1000, 0.001, 0.05)
    lastPhysicsTime = time

    syncPhysicsAgents()
    const states = visibleAgents.value.map(getPhysicsState)
    states.forEach((state, index) => {
      const target = state.points[state.targetIndex]
      const dx = target.x - state.x
      const dy = target.y - state.y
      const distance = Math.hypot(dx, dy) || 1
      if (distance < 2.4) {
        state.targetIndex = (state.targetIndex + 1) % state.points.length
      }

      const nextTarget = state.points[state.targetIndex]
      const toTargetX = nextTarget.x - state.x
      const toTargetY = nextTarget.y - state.y
      const targetDistance = Math.hypot(toTargetX, toTargetY) || 1
      const role = portraitRole(visibleAgents.value[index])
      const status = normalizeStatus(visibleAgents.value[index]?.status)
      const maxSpeed = (status === 'busy' || status === 'running' ? 9.4 : 7.2) * (1.12 - (role.scale - 0.9) * 0.25)
      const desiredSpeed = targetDistance < 8 ? maxSpeed * 0.58 : maxSpeed
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
      state.x = clamp(state.x + state.vx * dt, walkBounds.minX, walkBounds.maxX)
      state.y = clamp(state.y + state.vy * dt, walkBounds.minY, walkBounds.maxY)
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
    const walkActivity = clamp(state.speed / 7, 0.25, 1)
    return {
      left: `${state.x}%`,
      top: `${state.y}%`,
      zIndex: 4 + Math.round(state.y / 6),
      '--face': state.face,
      '--robe-color': role.robe,
      '--trim-color': role.trim,
      '--body-scale': role.scale,
      '--step-speed': `${clamp(role.step / Math.max(walkActivity, 0.35), 0.48, 1.15)}s`,
      '--step-lift': `${2 + walkActivity * 2}px`,
      '--shadow-scale': 0.88 + walkActivity * 0.16
    }
  }

  return {
    agentStyle,
    startPhysics,
    stopPhysics
  }
}
