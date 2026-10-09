const hasIdentityControl = value => Array.from(value).some(character => {
  const codePoint = character.codePointAt(0)
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
})

const isAbsent = value => value == null || (typeof value === 'string' && value.trim() === '')

const normalizeIdentityPart = (value) => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return ''
    value = String(value)
  }
  if (typeof value !== 'string') return ''
  const normalized = value.trim()
  return normalized && !hasIdentityControl(normalized) ? normalized : ''
}

const firstPresentIdentityPart = values => {
  for (const value of values) {
    if (!isAbsent(value)) return normalizeIdentityPart(value)
  }
  return ''
}

export const resolveHydratedIdentity = (user) => {
  if (!user || typeof user !== 'object') return { tenant: '', owner: '' }
  return {
    tenant: firstPresentIdentityPart([user.tenantId, user.tenantCode, user.tenant]),
    owner: firstPresentIdentityPart([user.id, user.openid])
  }
}

export const hasHydratedIdentity = (user) => {
  const { tenant, owner } = resolveHydratedIdentity(user)
  return Boolean(tenant && owner)
}

export const createHydratedIdentityScope = (user, clientId) => {
  const { tenant, owner } = resolveHydratedIdentity(user)
  const client = normalizeIdentityPart(clientId)
  return tenant && client && owner ? [tenant, client, owner].join('\u0000') : ''
}
