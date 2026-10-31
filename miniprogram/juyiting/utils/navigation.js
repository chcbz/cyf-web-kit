// Approved business origins/routes and public query state come from deployment configuration.
const validateWebUrl = (value, policy) => {
  if (typeof value !== 'string' || /[\s\\<>"\x00-\x1f\x7f]/.test(value)) return null
  const parts = /^(https:\/\/[a-z0-9.-]+(?::[0-9]+)?)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i.exec(value)
  if (!parts || !policy.origins.includes(parts[1].toLowerCase())) return null
  try {
    const path = decodeURIComponent(parts[2] || '/')
    if (/[\\<>"\x00-\x20\x7f]/.test(path) || path.split('/').some(part => part === '.' || part === '..')) return null
    if (!policy.paths.some(allowed => path === allowed || (allowed !== '/' && path.startsWith(allowed + '/')))) return null
    const seen = new Set()
    for (const pair of (parts[3] || '').slice(1).split('&').filter(Boolean)) {
      const index = pair.indexOf('=')
      const key = decodeURIComponent((index < 0 ? pair : pair.slice(0, index)).replace(/\+/g, ' '))
      const content = decodeURIComponent((index < 0 ? '' : pair.slice(index + 1)).replace(/\+/g, ' '))
      if (!policy.queryKeys.includes(key) || seen.has(key) || /[\x00-\x1f\x7f]/.test(content)) return null
      seen.add(key)
    }
    const hash = decodeURIComponent((parts[4] || '').slice(1))
    if (/[\s\\<>"?=&\x00-\x1f\x7f]/.test(hash)) return null
    return value
  } catch { return null }
}
const decodeOption = value => {
  if (typeof value !== 'string') return null
  try { return /^https:\/\//i.test(value) ? value : decodeURIComponent(value) } catch { return null }
}
const withOrientation = (url, orientation) => {
  const hashIndex = url.indexOf('#')
  const hash = hashIndex < 0 ? '' : url.slice(hashIndex)
  const base = hashIndex < 0 ? url : url.slice(0, hashIndex)
  const queryIndex = base.indexOf('?')
  const path = queryIndex < 0 ? base : base.slice(0, queryIndex)
  const query = (queryIndex < 0 ? '' : base.slice(queryIndex + 1)).split('&').filter(Boolean)
    .filter(pair => decodeURIComponent(pair.split('=')[0]) !== 'nativeOrientation')
  query.push('nativeOrientation=' + orientation)
  return path + '?' + query.join('&') + hash
}
const readReturnTarget = (options, policy) => {
  if (!['portrait', 'landscape'].includes(options.orientation)) return null
  const url = validateWebUrl(decodeOption(options.returnUrl), policy)
  if (!url) return null
  const label = decodeOption(options.returnLabel)?.replace(/[\x00-\x1f\x7f]/g, '').trim() || '返回来源页面'
  return { url, label, orientation: options.orientation }
}
const returnRoute = target => '/pages/' + (target.orientation === 'landscape' ? 'landscape' : 'index') + '/index?url=' + encodeURIComponent(target.url)
module.exports = { validateWebUrl, decodeOption, withOrientation, readReturnTarget, returnRoute }
