import waterMarginAgents from '@/assets/juyiting/water-margin-agents.png'
import { portraitRoles } from '@/constants/juyiting'

export const agentSeed = (agent) => {
  const source = agent?.personaCode || agent?.personaName || agent?.name || agent?.agentId || ''
  return Array.from(source).reduce((sum, char) => sum + char.charCodeAt(0), 0)
}

const parseVisualConfig = (agent) => {
  if (!agent?.visualConfig) return null
  if (typeof agent.visualConfig === 'object') return agent.visualConfig
  try {
    return JSON.parse(agent.visualConfig)
  } catch {
    return null
  }
}

export const portraitRole = (agent) => {
  const explicitName = `${agent?.personaName || ''}${agent?.name || ''}${agent?.personaCode || ''}`
  const matched = portraitRoles.find(role => explicitName.includes(role.name))
  const fallback = matched || portraitRoles[agentSeed(agent) % portraitRoles.length]
  const visual = parseVisualConfig(agent)
  return {
    ...fallback,
    slug: agent?.personaCode || fallback.slug,
    name: agent?.name || agent?.personaName || fallback.name,
    title: agent?.title || fallback.title,
    x: Number.isFinite(Number(visual?.gridX)) ? Number(visual.gridX) % 3 : fallback.x,
    y: Number.isFinite(Number(visual?.gridY)) ? Number(visual.gridY) % 2 : fallback.y
  }
}

export const portraitName = (agent) => {
  const name = agent?.name || agent?.personaName || portraitRole(agent).name
  const title = agent?.title || portraitRole(agent).title
  const star = agent?.starName ? ` / ${agent.starName}` : ''
  return `${name}${title ? `·${title}` : ''}${star}`
}

export const portraitShortName = (agent) => portraitRole(agent).name

export const roleClass = (agent) => `role-${String(portraitRole(agent).slug || 'default').replace(/[^a-zA-Z0-9_-]/g, '-')}`

export const portraitStyle = (agent) => {
  if (agent?.avatar) {
    return {
      backgroundImage: `url("${agent.avatar}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center'
    }
  }

  const role = portraitRole(agent)
  if (role.avatar) {
    return {
      backgroundImage: `url("${role.avatar}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center'
    }
  }

  return {
    backgroundImage: `url("${waterMarginAgents}")`,
    backgroundSize: '300% 200%',
    backgroundPosition: `${role.x * 50}% ${role.y * 100}%`
  }
}
