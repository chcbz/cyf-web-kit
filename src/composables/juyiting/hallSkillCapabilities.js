import { typedId } from './hallTypedDeliberation.js'
const required = (value, fields) => value && !Array.isArray(value) && typeof value === 'object' && fields.every(key => Object.hasOwn(value, key))
const modes = ['FREE', 'FIXED', 'METERED', 'UNKNOWN']
const costFields = ['mode', 'amount', 'currency', 'unit', 'description', 'source', 'updatedAt']
export const skillCostInfo = value => {
  if (!value || !modes.includes(value.mode) ||
    (value.amount != null && (typeof value.amount !== 'string' || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value.amount))) ||
    costFields.filter(key => !['mode', 'amount'].includes(key)).some(key => value[key] != null && typeof value[key] !== 'string')) return Object.freeze({ mode: 'UNKNOWN' })
  return Object.freeze(Object.fromEntries(costFields.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]])))
}
export const skillCostText = value => {
  const cost = skillCostInfo(value)
  if (cost.mode === 'UNKNOWN') return '运行费用未知（不等于免费）'
  if (cost.mode === 'FREE') return '运行说明：免费'
  const amount = cost.amount == null ? '金额未提供' : `${cost.amount}${cost.currency ? ` ${cost.currency}` : ''}${cost.unit ? ` / ${cost.unit}` : ''}`
  return `运行说明：${cost.mode === 'FIXED' ? '固定' : '按量'} · ${amount}${cost.description ? ` · ${cost.description}` : ''}（登记信息，非平台实扣）`
}
export const skillCapabilityProjection = raw => {
  if (!required(raw, ['catalogRevision', 'items']) || (raw.catalogRevision !== null && !typedId(raw.catalogRevision)) || !Array.isArray(raw.items)) return null
  const keys = new Set()
  const items = []
  for (const item of raw.items) {
    if (!required(item, ['skillKey', 'skillVersion', 'title', 'state', 'reasonCode', 'costInfo']) || !typedId(item.skillKey) || !typedId(item.skillVersion) || typeof item.title !== 'string' || !item.title || !['CALLABLE', 'UNAVAILABLE'].includes(item.state) ||
      (item.reasonCode !== null && !typedId(item.reasonCode)) || (item.state === 'CALLABLE' && item.reasonCode !== null)) return null
    const key = JSON.stringify([item.skillKey, item.skillVersion]); if (keys.has(key)) return null; keys.add(key)
    items.push(Object.freeze({ skillKey: item.skillKey, skillVersion: item.skillVersion, title: item.title, state: item.state, reasonCode: item.reasonCode, costInfo: skillCostInfo(item.costInfo) }))
  }
  return Object.freeze({ catalogRevision: raw.catalogRevision, items: Object.freeze(items) })
}
