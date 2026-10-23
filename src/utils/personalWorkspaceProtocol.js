import { validMaterialVersion } from '../composables/juyiting/materialVersion.js'

export { validMaterialVersion }
export const workspaceDecimal = value => typeof value === 'string' &&
  /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 19 && BigInt(value) <= 9223372036854775807n
export const workspaceRevisionTag = (id, revision) => {
  if (typeof id !== 'string' || !id || id.length > 100 || /^\s|\s$/.test(id) ||
    /["\\]/.test(id) || [...id].some(char => char.codePointAt(0) < 32 || char.codePointAt(0) === 127) || !workspaceDecimal(revision) || BigInt(revision) < 1n) {
    throw new Error('资料版本标识无效，请重新读取。')
  }
  return `"${id}:${revision}"`
}
export const workspaceByteText = value => {
  const raw = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : value
  if (!workspaceDecimal(raw)) return '大小未知'
  const size = BigInt(raw)
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB']
  let divisor = 1n
  let index = 0
  while (index < units.length - 1 && size >= divisor * 1024n) { divisor *= 1024n; index += 1 }
  return index === 0 ? `${size} B` : `${size / divisor}.${(size % divisor) * 10n / divisor} ${units[index]}`
}
