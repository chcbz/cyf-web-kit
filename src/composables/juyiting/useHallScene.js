import { computed, ref } from 'vue'
import {
  HALL_BUBBLE_PRESETS,
  HALL_CHARACTER_VISUALS,
  HALL_FEATURED_HEROES,
  HALL_SCENE_HOTSPOTS,
  HALL_SCENE_MAX_PROMINENT_MOTION,
  HALL_SCENE_REGIONS
} from '../../constants/juyitingScene.js'
import { clampPointToRegion } from '../../game/walkableArea.js'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const normalizeAgentId = (agentOrId) => {
  if (!agentOrId) return ''
  if (typeof agentOrId === 'string') return agentOrId
  return agentOrId.agentId || agentOrId.personaCode || agentOrId.name || ''
}

const asAgentList = (agents) => Array.isArray(agents) ? agents : [agents].filter(Boolean)

const featuredHeroById = Object.fromEntries(HALL_FEATURED_HEROES.map(hero => [hero.agentId, hero]))

const withFeaturedHeroes = (agents) => {
  const byId = new Map()
  const featuredVisuals = new Set()
  agents.forEach((agent) => {
    const agentId = normalizeAgentId(agent)
    if (!agentId) return
    const visualKey = agentVisualKey(agent)
    const featuredHero = featuredHeroById[visualKey] || featuredHeroById[agentId]
    if (featuredHero) featuredVisuals.add(featuredHero.agentId)
    byId.set(agentId, featuredHero ? { ...featuredHero, ...agent, featuredHero: true, synthetic: false } : agent)
  })

  HALL_FEATURED_HEROES.forEach((hero) => {
    if (!byId.has(hero.agentId) && !featuredVisuals.has(hero.agentId)) {
      byId.set(hero.agentId, {
        ...hero,
        status: 'online',
        abilities: [],
        featuredHero: true,
        synthetic: true
      })
    }
  })

  return [...byId.values()]
}

const agentSeed = (agent) => {
  const key = normalizeAgentId(agent)
  return Array.from(key || 'agent').reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0)
}

const sceneRole = (agent) => {
  const seed = agentSeed(agent)
  const colors = ['#7c1f1b', '#23483e', '#3f4f78', '#8b5a1f', '#5c2d63', '#2f6f6a']
  const trims = ['#f4c84c', '#d7b875', '#c08a46', '#d9d0be']
  return {
    slug: agentVisualKey(agent),
    robe: colors[seed % colors.length],
    trim: trims[seed % trims.length],
    scale: 0.94 + (seed % 7) * 0.025,
    step: 0.6 + (seed % 9) * 0.035,
    gaitWeight: 0.8 + (seed % 5) * 0.08,
    stance: 0.16 + (seed % 4) * 0.06
  }
}

const randomFromSeed = (seed, offset = 0) => {
  const value = Math.sin((seed + 1) * 121.7 + offset * 297.3) * 43758.5453
  return value - Math.floor(value)
}

const sampleRegionPoint = (region, seed, offset = 0) => {
  const x = region.bounds.x1 + (region.bounds.x2 - region.bounds.x1) * randomFromSeed(seed, offset)
  const y = region.bounds.y1 + (region.bounds.y2 - region.bounds.y1) * randomFromSeed(seed, offset + 1)
  return clampPointToRegion({
    x: clamp(x, 0, 100),
    y: clamp(y, 0, 100)
  }, region)
}

const agentVisualKey = (agent) => {
  const code = String(agent?.personaCode || agent?.agentId || agent?.name || '').toLowerCase()
  const name = String(agent?.name || agent?.personaName || '').toLowerCase()
  return Object.keys(HALL_CHARACTER_VISUALS).find(key => (
    code === key ||
    code.endsWith(`-${key}`) ||
    name.includes(key)
  )) || 'default'
}

const sceneStatusFor = (status, override) => {
  if (status === 'error') return 'error'
  if (status === 'offline') return 'offline'
  if (override?.sceneStatus) return override.sceneStatus
  if (status === 'busy') return 'busy'
  return 'idle'
}

const bubbleFor = (agentId, transientByAgent) => {
  const feedback = transientByAgent[agentId]
  if (!feedback?.bubble) return null
  return feedback.bubble
}

const trimBubble = (text, tone) => {
  const value = String(text || '').trim()
  const maxLength = HALL_BUBBLE_PRESETS[tone]?.maxLength || HALL_BUBBLE_PRESETS.speech.maxLength
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}...`
}

export const useHallScene = ({
  mapAgents,
  normalizeStatus = value => String(value || '').toLowerCase(),
  selectedAgent,
  selectedTask: _selectedTask
}) => {
  const transientAgents = ref({})
  const transientHotspots = ref({})

  const selectedAgentId = computed(() => normalizeAgentId(selectedAgent?.value))

  const addAgentFeedback = (agentId, feedback) => {
    if (!agentId) return
    transientAgents.value = {
      ...transientAgents.value,
      [agentId]: {
        ...(transientAgents.value[agentId] || {}),
        ...feedback
      }
    }
  }

  const addBubble = (agentId, text, tone = 'speech') => {
    addAgentFeedback(agentId, {
      bubble: {
        id: `${agentId}-${Date.now()}-${tone}`,
        agentId,
        text: trimBubble(text, tone),
        tone,
        expiresAt: Date.now() + (HALL_BUBBLE_PRESETS[tone]?.ttlMs || HALL_BUBBLE_PRESETS.speech.ttlMs)
      }
    })
  }

  const setHotspotFeedback = (hotspotId, feedbackText, state = 'active') => {
    transientHotspots.value = {
      ...transientHotspots.value,
      [hotspotId]: {
        state,
        feedbackText,
        expiresAt: Date.now() + HALL_BUBBLE_PRESETS.system.ttlMs
      }
    }
  }

  const sceneAgents = computed(() => {
    const agents = withFeaturedHeroes([...(mapAgents?.value || [])])
    const selectedId = selectedAgentId.value
    const derived = agents.map((agent, index) => {
      const seed = agentSeed(agent) + index * 17
      const visualKey = agentVisualKey(agent)
      const visual = HALL_CHARACTER_VISUALS[visualKey] || HALL_CHARACTER_VISUALS.default
      const transient = transientAgents.value[normalizeAgentId(agent)] || {}
      const featuredHero = featuredHeroById[visualKey] || featuredHeroById[normalizeAgentId(agent)]
      const regionId = transient.regionId || featuredHero?.regionId || visual.defaultRegion || HALL_CHARACTER_VISUALS.default.defaultRegion
      const region = HALL_SCENE_REGIONS[regionId] || HALL_SCENE_REGIONS.idleFloor
      const point = clampPointToRegion(transient.destination || featuredHero?.anchor || sampleRegionPoint(region, seed, 1), region)
      const status = normalizeStatus(agent.status)
      const sceneStatus = sceneStatusFor(status, transient)
      const selected = selectedId === normalizeAgentId(agent)
      const facing = transient.facing || featuredHero?.facing || (point.x >= region.anchor.x ? 'left' : 'right')
      return {
        ...agent,
        rawAgent: agent,
        agentId: normalizeAgentId(agent),
        status: agent.status,
        sceneStatus,
        x: point.x,
        y: point.y,
        depth: (region.depthOffset || 0) + point.y,
        scale: 0.46 + clamp((point.y - 34) / 45, 0, 1) * 0.28,
        facing,
        regionId,
        destination: transient.destination ? point : undefined,
        walkableRegion: region,
        selected,
        focused: selected || Boolean(transient.focused),
        bubble: bubbleFor(normalizeAgentId(agent), transientAgents.value),
        recommended: Boolean(transient.recommended),
        featuredHero: Boolean(agent.featuredHero || featuredHero),
        synthetic: Boolean(agent.synthetic),
        visualKey: visual.visualKey || visualKey,
        prominentMotion: Boolean(transient.prominentMotion),
        motionSeed: seed
      }
    })

    return derived.sort((a, b) => a.depth - b.depth)
  })

  const sceneBubbles = computed(() => sceneAgents.value
    .map(agent => agent.bubble)
    .filter(Boolean)
    .slice(0, 3))

  const sceneHotspots = computed(() => HALL_SCENE_HOTSPOTS.map((hotspot) => ({
    ...hotspot,
    state: transientHotspots.value[hotspot.id]?.state || 'idle',
    feedbackText: transientHotspots.value[hotspot.id]?.feedbackText || ''
  })))

  const sceneAgentStyle = (agent) => {
    const sceneAgent = agent?.rawAgent ? agent : sceneAgents.value.find(item => item.agentId === normalizeAgentId(agent)) || agent
    const role = sceneRole(sceneAgent)
    const face = sceneAgent.facing === 'left' ? -1 : 1
    return {
      left: `${sceneAgent.x}%`,
      top: `${sceneAgent.y}%`,
      zIndex: 4 + Math.round(sceneAgent.depth / 5),
      '--face': face,
      '--robe-color': role.robe,
      '--trim-color': role.trim,
      '--body-scale': role.scale,
      '--depth-scale': sceneAgent.scale?.toFixed ? sceneAgent.scale.toFixed(3) : sceneAgent.scale,
      '--gait-weight': role.gaitWeight || 1,
      '--stance': role.stance || 0.2,
      '--step-speed': sceneAgent.sceneStatus === 'busy' || sceneAgent.prominentMotion ? '0.68s' : '0.92s',
      '--idle-speed': `${clamp(role.step * 3.8, 2.25, 3.8)}s`,
      '--step-lift': sceneAgent.prominentMotion ? '2px' : '0px',
      '--shadow-scale': sceneAgent.prominentMotion ? 1 : 0.88,
      '--walk-play-state': sceneAgent.prominentMotion ? 'running' : 'paused'
    }
  }

  const markTaskAssigned = (task, agents) => {
    const targets = asAgentList(agents)
    const prominentIds = new Set(targets.slice(0, HALL_SCENE_MAX_PROMINENT_MOTION).map(normalizeAgentId))
    targets.forEach((agent, index) => {
      const agentId = normalizeAgentId(agent)
      const region = HALL_SCENE_REGIONS.bountyBoard
      const destination = sampleRegionPoint(region, agentSeed(agent), index + 21)
      addAgentFeedback(agentId, {
        regionId: 'bountyBoard',
        destination,
        sceneStatus: 'busy',
        prominentMotion: prominentIds.has(agentId),
        focused: true,
        facing: destination.x > 50 ? 'left' : 'right'
      })
      addBubble(agentId, `领令：${task?.title || '榜文'}`, 'task')
    })
    setHotspotFeedback('bountyBoard', targets.length > 1 ? `${targets.length} 位已领令` : '榜文已点将')
  }

  const markTaskCreated = () => {
    setHotspotFeedback('bountyBoard', '榜文已张')
  }

  const markTaskArchived = () => {
    setHotspotFeedback('bountyBoard', '收入案卷')
  }

  const markTaskAutoAssigned = (task, assignedAgentsOrIds = []) => {
    const targets = asAgentList(assignedAgentsOrIds)
    if (!targets.length) {
      setHotspotFeedback('bountyBoard', '宋江已点将')
      return
    }
    markTaskAssigned(task, targets)
  }

  const markAgentSpeaking = (agentOrId, text, tone = 'speech') => {
    const agentId = normalizeAgentId(agentOrId)
    addAgentFeedback(agentId, {
      sceneStatus: tone === 'task' ? 'busy' : 'talk',
      focused: true
    })
    addBubble(agentId, text || '收到传令', tone)
  }

  const markDiscussionStarted = (task, participantAgentIds = []) => {
    participantAgentIds.forEach((agentOrId, index) => {
      const agentId = normalizeAgentId(agentOrId)
      const region = HALL_SCENE_REGIONS.councilTable
      const destination = sampleRegionPoint(region, agentSeed({ agentId }), index + 41)
      addAgentFeedback(agentId, {
        regionId: 'councilTable',
        destination,
        sceneStatus: 'discuss',
        prominentMotion: index < HALL_SCENE_MAX_PROMINENT_MOTION,
        focused: true,
        facing: destination.x > 50 ? 'left' : 'right'
      })
    })
    setHotspotFeedback('mainSeat', task?.title ? `议：${task.title}` : '厅前议事')
  }

  const markLibrarySearching = (state = 'searching') => {
    const textByState = {
      searching: '正在查卷',
      success: '检得资料',
      error: '查卷未成'
    }
    setHotspotFeedback('libraryShelf', textByState[state] || '藏经阁有动静', state === 'error' ? 'error' : 'active')
  }

  const markLibraryCitation = () => {
    setHotspotFeedback('libraryShelf', '案卷已引用')
  }

  const markRecommendedAgents = (agentsOrIds = []) => {
    const mapAgentIds = new Set((mapAgents?.value || []).map(normalizeAgentId))
    asAgentList(agentsOrIds)
      .map(normalizeAgentId)
      .filter(agentId => agentId && mapAgentIds.has(agentId))
      .slice(0, HALL_SCENE_MAX_PROMINENT_MOTION)
      .forEach(agentId => {
        addAgentFeedback(agentId, {
          recommended: true,
          focused: true,
          sceneStatus: 'idle'
        })
      })
    setHotspotFeedback('bountyBoard', '荐单已出')
  }

  const syncAfterPersonaChanged = () => {
    transientAgents.value = {}
  }

  const resetSceneFeedback = () => {
    transientAgents.value = {}
    transientHotspots.value = {}
  }

  return {
    focusAgent: agent => addAgentFeedback(normalizeAgentId(agent), { focused: true }),
    markAgentSpeaking,
    markDiscussionStarted,
    markLibraryCitation,
    markLibrarySearching,
    markRecommendedAgents,
    markTaskArchived,
    markTaskAssigned,
    markTaskAutoAssigned,
    markTaskCreated,
    resetAgentRegion: agent => addAgentFeedback(normalizeAgentId(agent), { regionId: undefined, destination: undefined }),
    resetSceneFeedback,
    sceneAgents,
    sceneAgentStyle,
    sceneBubbles,
    sceneHotspots,
    syncAfterPersonaChanged
  }
}
