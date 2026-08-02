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

const roleBySlug = new Map(portraitRoles.map(role => [role.slug, role]))
const portraitCache = new Map()
const publicAsset = (path) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
const staticPortrait = (role) => publicAsset(`juyiting-portraits/${role.slug}.svg`)
const thumbnailPortrait = (role) => publicAsset(`juyiting-portraits/thumbs/${role.slug}.webp`)

const realisticPortraits = new Map([
  ['songjiang', 'songjiang-realistic.png'],
  ['wuyong', 'wuyong-realistic.png'],
  ['wusong', 'wusong-realistic.png'],
  ['husanniang', 'husanniang-realistic.png']
])

const atlasCellPosition = [
  ['0%', '0%'],
  ['100%', '0%'],
  ['0%', '100%'],
  ['100%', '100%']
]

const realisticAtlasPortraits = new Map(
  portraitRoles
    .filter(role => !realisticPortraits.has(role.slug))
    .map((role, index) => {
      const atlasNo = Math.floor(index / 4) + 1
      const cell = index % 4
      const [x, y] = atlasCellPosition[cell]
      return [role.slug, {
        filename: `water-margin-atlas-${String(atlasNo).padStart(3, '0')}.png`,
        position: `${x} ${y}`
      }]
    })
)

const normalizeRoleCode = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/^agent-/, '')
  .replace(/^jyt-[^-]+-/, '')

const roleByCode = (value) => {
  const code = normalizeRoleCode(value)
  if (!code) return null
  if (roleBySlug.has(code)) return roleBySlug.get(code)
  return portraitRoles.find(role => code === role.slug || code.endsWith(`-${role.slug}`)) || null
}

const escapeXml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const motifMarkup = (role) => {
  const trim = escapeXml(role.trim)
  const robe = escapeXml(role.robe)
  switch (role.motif) {
    case 'scroll':
      return `<path d="M23 61h34q5 0 5 5t-5 5H23q-5 0-5-5t5-5Z" fill="#f3dfaa" stroke="${trim}" stroke-width="2"/><path d="M28 66h24" stroke="#7b4d26" stroke-width="2"/>`
    case 'craft':
      return `<circle cx="27" cy="66" r="6" fill="#f5d36a" stroke="${trim}" stroke-width="2"/><path d="M35 71l18-18" stroke="${trim}" stroke-width="5" stroke-linecap="round"/>`
    case 'weapon':
      return `<path d="M18 70L62 26" stroke="${trim}" stroke-width="4" stroke-linecap="round"/><path d="M58 22l7 8-12 4Z" fill="#f7ead0" stroke="${trim}" stroke-width="2"/>`
    case 'wave':
      return `<path d="M14 67q10-10 20 0t20 0 20 0" fill="none" stroke="#dbeaf0" stroke-width="4" stroke-linecap="round"/><path d="M16 74q9-7 18 0t18 0 18 0" fill="none" stroke="${trim}" stroke-width="3" stroke-linecap="round"/>`
    case 'beast':
      return `<path d="M22 67q18-21 36 0-18 12-36 0Z" fill="${trim}" opacity=".9"/><circle cx="33" cy="65" r="2" fill="${robe}"/><circle cx="47" cy="65" r="2" fill="${robe}"/>`
    case 'spirit':
      return `<path d="M40 52q13 8 7 22-7-5-7-12-2 8-9 14-6-15 9-24Z" fill="${trim}" opacity=".95"/><path d="M43 57q5 5 1 11" stroke="#fff2c4" stroke-width="2" fill="none"/>`
    case 'wind':
      return `<path d="M19 63h34q9 0 9-7 0-5-5-7" fill="none" stroke="${trim}" stroke-width="4" stroke-linecap="round"/><path d="M24 72h24q7 0 7-5" fill="none" stroke="#f7ead0" stroke-width="3" stroke-linecap="round"/>`
    case 'flourish':
      return `<path d="M40 58c12 8 12 20 0 24-12-4-12-16 0-24Z" fill="${trim}" opacity=".92"/><circle cx="40" cy="69" r="5" fill="#f7ead0"/>`
    default:
      return `<path d="M40 57l8 9-3 12H35l-3-12Z" fill="${trim}" opacity=".92"/><path d="M40 59v18" stroke="#f7ead0" stroke-width="2"/>`
  }
}

const headwearMarkup = (role) => {
  const trim = escapeXml(role.trim)
  const robe = escapeXml(role.robe)
  if (role.headwear === 'cap') {
    return `<path d="M25 25q15-13 30 0l-4 10H29Z" fill="${robe}" stroke="${trim}" stroke-width="2"/><path d="M28 26h24" stroke="${trim}" stroke-width="3" stroke-linecap="round"/>`
  }
  if (role.headwear === 'band') {
    return `<path d="M24 30q16-10 32 0v7H24Z" fill="${trim}"/><path d="M54 32l10-5-3 11Z" fill="${trim}"/>`
  }
  return `<path d="M23 31q17-20 34 0l-3 8H26Z" fill="${robe}" stroke="${trim}" stroke-width="2"/><path d="M40 13v13" stroke="${trim}" stroke-width="4" stroke-linecap="round"/>`
}

const bannerText = (role) => escapeXml(role.title.length > 3 ? role.title.slice(0, 3) : role.title)

const specialtyPortraitSvg = (role) => {
  const robe = escapeXml(role.robe)
  const trim = escapeXml(role.trim)
  const title = bannerText(role)
  if (role.slug === 'songjiang') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
      <defs>
        <radialGradient id="songjiangSky" cx=".35" cy=".22" r=".85">
          <stop offset="0" stop-color="#f7e6b6"/>
          <stop offset=".62" stop-color="#9fb6a0"/>
          <stop offset="1" stop-color="#394b3f"/>
        </radialGradient>
        <clipPath id="round"><circle cx="64" cy="64" r="61"/></clipPath>
      </defs>
      <g clip-path="url(#round)">
        <rect width="128" height="128" fill="url(#songjiangSky)"/>
        <path d="M7 34q16-14 33-5 14-21 37-7 20-8 34 11 11 2 15 12H7Z" fill="#e8e2c4" opacity=".78"/>
        <path d="M24 43q10 13 2 27M49 39q8 14 0 31M77 40q10 14 0 31M101 43q7 12 1 25" stroke="#e9f3f2" stroke-width="4" stroke-linecap="round" opacity=".76"/>
        <path d="M25 121q2-42 39-42t39 42Z" fill="${robe}" stroke="${trim}" stroke-width="4"/>
        <path d="M32 93q32 17 64 0" fill="none" stroke="#f3ca57" stroke-width="5" stroke-linecap="round"/>
        <circle cx="64" cy="57" r="28" fill="#d8a06d" stroke="#3a2418" stroke-width="3"/>
        <path d="M36 45q28-29 56 0l-4 15H40Z" fill="#26251f" stroke="#f2d56b" stroke-width="3"/>
        <path d="M50 33h28l5 12H45Z" fill="#7c1f1b" stroke="#f2d56b" stroke-width="3"/>
        <path d="M52 58q7 4 14 0M73 58q7 4 14 0" stroke="#2b2118" stroke-width="3" stroke-linecap="round"/>
        <path d="M64 62q-4 8 2 12" stroke="#8b5b3d" stroke-width="3" fill="none" stroke-linecap="round"/>
        <path d="M48 78q15 14 33 0-4 20-17 25-11-5-16-25Z" fill="#251d18" opacity=".9"/>
        <circle cx="99" cy="91" r="17" fill="#b82722" stroke="#f4c84c" stroke-width="4"/>
        <path d="M89 91h20M99 81v20" stroke="#f8ddb0" stroke-width="4" stroke-linecap="round"/>
        <path d="M13 104h62q8 0 8 8t-8 8H13Z" fill="#f7ead0" stroke="#f4c84c" stroke-width="3"/>
        <text x="45" y="116" text-anchor="middle" font-family="serif" font-size="17" font-weight="700" fill="#4d2d1e">${title}</text>
      </g>
    </svg>`
  }
  if (role.slug === 'wuyong') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
      <defs>
        <radialGradient id="wuyongSky" cx=".45" cy=".2" r=".8">
          <stop offset="0" stop-color="#f5e9bd"/>
          <stop offset=".48" stop-color="#86a493"/>
          <stop offset="1" stop-color="#1f3c35"/>
        </radialGradient>
        <clipPath id="round"><circle cx="64" cy="64" r="61"/></clipPath>
      </defs>
      <g clip-path="url(#round)">
        <rect width="128" height="128" fill="url(#wuyongSky)"/>
        <g fill="#f8e8a9">
          <circle cx="24" cy="26" r="2"/><circle cx="44" cy="18" r="2"/><circle cx="67" cy="24" r="2"/><circle cx="99" cy="21" r="2"/><circle cx="112" cy="43" r="2"/>
        </g>
        <path d="M24 25l20-7 23 6 32-3 13 22" stroke="#f8e8a9" stroke-width="1.8" fill="none" opacity=".75"/>
        <path d="M25 121q2-39 39-39t39 39Z" fill="${robe}" stroke="${trim}" stroke-width="4"/>
        <path d="M37 92q27 14 54 0" stroke="#d7b875" stroke-width="4" fill="none" stroke-linecap="round"/>
        <circle cx="64" cy="57" r="27" fill="#ddb17b" stroke="#2b261c" stroke-width="3"/>
        <path d="M39 42q25-18 50 0l-4 16H43Z" fill="#2d4c42" stroke="#d7b875" stroke-width="3"/>
        <path d="M43 43h42M50 35q14-8 28 0" stroke="#f0d88f" stroke-width="3" stroke-linecap="round"/>
        <path d="M52 59q6 3 12 0M73 59q6 3 12 0" stroke="#1e1a16" stroke-width="3" stroke-linecap="round"/>
        <path d="M59 75q6 4 13 0" stroke="#7a3030" stroke-width="3" stroke-linecap="round"/>
        <path d="M18 92q25-34 49-42-1 35-34 53Z" fill="#f7ead0" stroke="#2f4d43" stroke-width="3"/>
        <path d="M28 89q14-20 33-32M38 96q12-22 25-36M49 98q7-19 15-36" stroke="#9e8754" stroke-width="2"/>
        <circle cx="96" cy="82" r="17" fill="#243f37" stroke="#d7b875" stroke-width="3"/>
        <path d="M96 69v26M83 82h26M87 73l18 18M105 73L87 91" stroke="#f8e8a9" stroke-width="2"/>
        <path d="M47 106h63q7 0 7 8t-7 8H47Z" fill="#f7ead0" stroke="#d7b875" stroke-width="3"/>
        <text x="80" y="118" text-anchor="middle" font-family="serif" font-size="17" font-weight="700" fill="#2e4036">${title}</text>
      </g>
    </svg>`
  }
  if (role.slug === 'wusong') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
      <defs>
        <radialGradient id="wusongSky" cx=".35" cy=".2" r=".86">
          <stop offset="0" stop-color="#f6e4bc"/>
          <stop offset=".55" stop-color="#a76f43"/>
          <stop offset="1" stop-color="#2b2722"/>
        </radialGradient>
        <clipPath id="round"><circle cx="64" cy="64" r="61"/></clipPath>
      </defs>
      <g clip-path="url(#round)">
        <rect width="128" height="128" fill="url(#wusongSky)"/>
        <path d="M5 84q25-26 51 0t67 0v44H5Z" fill="#35251c" opacity=".42"/>
        <path d="M34 121q-2-41 30-41t34 41Z" fill="#5b3b25" stroke="#d9d0be" stroke-width="4"/>
        <path d="M39 87q24 19 50 0" stroke="#d9d0be" stroke-width="5" fill="none" stroke-linecap="round"/>
        <circle cx="64" cy="56" r="27" fill="#c88d5c" stroke="#231a14" stroke-width="3"/>
        <path d="M38 38q26-18 52 0v10H38Z" fill="#d9d0be" stroke="#2a1c15" stroke-width="3"/>
        <path d="M35 47h58" stroke="#6d3f1f" stroke-width="6" stroke-linecap="round"/>
        <path d="M88 43l20-10-6 23Z" fill="#d9d0be" stroke="#2a1c15" stroke-width="3"/>
        <path d="M52 58q6 4 12 0M73 58q7 4 13 0" stroke="#1f1713" stroke-width="3" stroke-linecap="round"/>
        <path d="M59 76q7 6 15 0" stroke="#7b2b22" stroke-width="3" stroke-linecap="round"/>
        <path d="M19 96q6-29 31-38 5 30-18 48Z" fill="#d88d36" stroke="#2a1c15" stroke-width="3"/>
        <path d="M24 90l16-8M29 101l15-11M25 79l15-8" stroke="#17120e" stroke-width="3" stroke-linecap="round"/>
        <path d="M101 40l-16 62" stroke="#d9d0be" stroke-width="6" stroke-linecap="round"/>
        <path d="M97 40l8-7 3 10Z" fill="#d9d0be"/>
        <path d="M38 105h55q7 0 7 8t-7 8H38Z" fill="#f7ead0" stroke="#d9d0be" stroke-width="3"/>
        <text x="65" y="118" text-anchor="middle" font-family="serif" font-size="18" font-weight="700" fill="#4b2d1b">${title}</text>
      </g>
    </svg>`
  }
  if (role.slug === 'husanniang') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
      <defs>
        <radialGradient id="husanniangSky" cx=".42" cy=".2" r=".84">
          <stop offset="0" stop-color="#f7e9c7"/>
          <stop offset=".52" stop-color="#5f9a89"/>
          <stop offset="1" stop-color="#263d3a"/>
        </radialGradient>
        <clipPath id="round"><circle cx="64" cy="64" r="61"/></clipPath>
      </defs>
      <g clip-path="url(#round)">
        <rect width="128" height="128" fill="url(#husanniangSky)"/>
        <path d="M16 95q26-24 48 0t48 0v33H16Z" fill="#e5c06a" opacity=".28"/>
        <path d="M29 121q4-40 35-40t35 40Z" fill="${robe}" stroke="${trim}" stroke-width="4"/>
        <path d="M38 89q26 17 52 0" stroke="#d4a949" stroke-width="5" fill="none" stroke-linecap="round"/>
        <circle cx="64" cy="56" r="26" fill="#e1b480" stroke="#26322d" stroke-width="3"/>
        <path d="M39 43q25-18 50 0l-5 12H44Z" fill="#263d3a" stroke="#d4a949" stroke-width="3"/>
        <path d="M41 45q23-10 46 0" stroke="#d4a949" stroke-width="4" stroke-linecap="round"/>
        <path d="M36 50q28 11 56 0" stroke="#9f2730" stroke-width="5" stroke-linecap="round"/>
        <path d="M53 59q6 3 12 0M73 59q6 3 12 0" stroke="#1f1713" stroke-width="3" stroke-linecap="round"/>
        <path d="M59 75q7 5 14 0" stroke="#9f2730" stroke-width="3" stroke-linecap="round"/>
        <path d="M23 94L54 44" stroke="#f2e4c6" stroke-width="6" stroke-linecap="round"/>
        <path d="M21 96l10-1-6-8Z" fill="#f2e4c6"/>
        <path d="M105 94L74 44" stroke="#f2e4c6" stroke-width="6" stroke-linecap="round"/>
        <path d="M107 96l-10-1 6-8Z" fill="#f2e4c6"/>
        <path d="M64 84c16 9 16 25 0 33-16-8-16-24 0-33Z" fill="#d4a949" stroke="#f7ead0" stroke-width="3"/>
        <path d="M32 105h64q7 0 7 8t-7 8H32Z" fill="#f7ead0" stroke="#d4a949" stroke-width="3"/>
        <text x="64" y="118" text-anchor="middle" font-family="serif" font-size="17" font-weight="700" fill="#2f4f46">${title}</text>
      </g>
    </svg>`
  }
  return null
}

const generatedPortrait = (role) => {
  const cacheKey = `${role.slug}:${role.robe}:${role.trim}:${role.motif}:${role.faceTone}:${role.headwear}:${role.beard}`
  if (portraitCache.has(cacheKey)) return portraitCache.get(cacheKey)

  const skin = ['#d9a46f', '#c88d5c', '#e1b480', '#b9794f', '#cf9868'][role.faceTone % 5]
  const svg = specialtyPortraitSvg(role) || `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f5e8c8"/>
        <stop offset="1" stop-color="${escapeXml(role.robe)}"/>
      </linearGradient>
      <clipPath id="round"><circle cx="40" cy="40" r="38"/></clipPath>
    </defs>
    <g clip-path="url(#round)">
      <rect width="80" height="80" fill="url(#bg)"/>
      <path d="M0 64q20-9 40 0t40 0v16H0Z" fill="#1f2f2a" opacity=".2"/>
      <circle cx="40" cy="35" r="19" fill="${skin}" stroke="${escapeXml(role.trim)}" stroke-width="2"/>
      ${headwearMarkup(role)}
      <path d="M18 80q3-25 22-25t22 25Z" fill="${escapeXml(role.robe)}" stroke="${escapeXml(role.trim)}" stroke-width="2"/>
      <path d="M29 41q4 3 8 0M43 41q4 3 8 0" stroke="#2b2018" stroke-width="2" stroke-linecap="round"/>
      <path d="M39 44q-2 5 2 6" stroke="#8a5638" stroke-width="2" fill="none" stroke-linecap="round"/>
      ${role.beard ? '<path d="M31 51q9 11 18 0-2 15-9 18-7-3-9-18Z" fill="#2a2018" opacity=".86"/>' : '<path d="M34 54q6 4 12 0" stroke="#8a2f2f" stroke-width="2" stroke-linecap="round"/>'}
      ${motifMarkup(role)}
      <circle cx="64" cy="17" r="11" fill="#f7ead0" stroke="${escapeXml(role.trim)}" stroke-width="2"/>
      <text x="64" y="21" text-anchor="middle" font-family="serif" font-size="10" font-weight="700" fill="#3b2a1d">${role.rankNo}</text>
    </g>
  </svg>`
  const style = {
    backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center'
  }
  portraitCache.set(cacheKey, style)
  return style
}

const realisticPortrait = (role) => {
  const filename = realisticPortraits.get(role.slug)
  if (filename) {
    return {
      backgroundImage: `url("${publicAsset(`juyiting-portraits/${filename}`)}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center'
    }
  }

  const atlas = realisticAtlasPortraits.get(role.slug)
  if (!atlas) return null
  return {
    backgroundImage: `url("${publicAsset(`juyiting-portraits/${atlas.filename}`)}")`,
    backgroundSize: '200% 200%',
    backgroundPosition: atlas.position
  }
}

export const portraitRole = (agent) => {
  const personaCode = agent?.personaCode || ''
  const explicitName = `${agent?.personaName || ''}${agent?.name || ''}${agent?.title || ''}${agent?.personaCode || ''}${agent?.agentId || ''}${agent?.starName || ''}`
  const matched = roleByCode(personaCode) || roleByCode(agent?.agentId) || portraitRoles.find(role => explicitName.includes(role.name) || explicitName.includes(role.title))
  const fallback = matched || portraitRoles[agentSeed(agent) % portraitRoles.length]
  const visual = parseVisualConfig(agent)
  return {
    ...fallback,
    slug: matched?.slug || fallback.slug,
    name: agent?.name || agent?.personaName || fallback.name,
    title: agent?.title || fallback.title,
    robe: visual?.robe || visual?.color || fallback.robe,
    trim: visual?.trim || fallback.trim,
    motif: visual?.motif || fallback.motif
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

export const portraitStyle = (agent, options = {}) => {
  if (agent?.avatar) {
    return {
      backgroundImage: `url("${agent.avatar}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center'
    }
  }

  const role = portraitRole(agent)
  const visual = parseVisualConfig(agent)
  if (visual?.robe || visual?.color || visual?.trim || visual?.motif) return generatedPortrait(role)

  if (!options.highRes) {
    return {
      backgroundImage: `url("${thumbnailPortrait(role)}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center'
    }
  }

  const realistic = realisticPortrait(role)
  if (realistic) return realistic

  return {
    backgroundImage: `url("${staticPortrait(role)}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center'
  }
}
