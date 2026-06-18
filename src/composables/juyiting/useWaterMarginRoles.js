import waterMarginAgents from '@/assets/juyiting/water-margin-agents.png'
import { portraitRoles } from '@/constants/juyiting'

export const agentSeed = (agent) => {
  const source = agent?.personaName || agent?.name || agent?.agentId || ''
  return Array.from(source).reduce((sum, char) => sum + char.charCodeAt(0), 0)
}

export const portraitRole = (agent) => {
  const explicitName = `${agent?.personaName || ''}${agent?.name || ''}`
  const matched = portraitRoles.find(role => explicitName.includes(role.name))
  if (matched) return matched
  return portraitRoles[agentSeed(agent) % portraitRoles.length]
}

export const portraitName = (agent) => {
  const role = portraitRole(agent)
  return `${role.name}${role.title ? `·${role.title}` : ''}`
}

export const portraitShortName = (agent) => portraitRole(agent).name

export const roleClass = (agent) => `role-${portraitRole(agent).slug}`

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
