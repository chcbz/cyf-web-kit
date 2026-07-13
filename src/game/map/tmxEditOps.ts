export type TmxScalar = string | number | boolean

export interface SetMapPropertyOperation {
  op: 'set-map-property'
  name: string
  value: TmxScalar
  type?: 'string' | 'int' | 'float' | 'bool'
}

export interface UpsertObjectGroupOperation {
  op: 'upsert-object-group'
  name: string
}

export interface TmxObjectSpec {
  stableId: string
  name?: string
  type?: string
  x?: number
  y?: number
  width?: number
  height?: number
  rotation?: number
  properties?: Readonly<Record<string, TmxScalar>>
  shape?:
    | { type: 'ellipse' }
    | { type: 'polygon' | 'polyline', points: readonly (readonly [number, number])[] }
}

export interface UpsertObjectByStableIdOperation {
  op: 'upsert-object-by-stable-id'
  group: string
  object: TmxObjectSpec
}

export type TmxEditOperation =
  | SetMapPropertyOperation
  | UpsertObjectGroupOperation
  | UpsertObjectByStableIdOperation

interface XmlElement {
  name: string
  attributes: Record<string, string>
  openStart: number
  openEnd: number
  closeStart: number
  closeEnd: number
  selfClosing: boolean
  children: XmlElement[]
}

interface OpenElement extends XmlElement {
  parent?: OpenElement
}

interface TagToken {
  name: string
  attributes: Record<string, string>
  start: number
  end: number
  closing: boolean
  selfClosing: boolean
}

export function applyTmxEditOps(
  sourceXml: string,
  operations: readonly TmxEditOperation[],
): string {
  if (typeof sourceXml !== 'string') throw new TypeError('TMX source must be a string')
  if (!Array.isArray(operations)) throw new TypeError('TMX operations must be an array')
  parseMap(sourceXml)

  let result = sourceXml
  for (const operation of operations) {
    if (!operation || typeof operation !== 'object') throw new TypeError('Invalid TMX edit operation')
    if (operation.op === 'set-map-property') result = setMapProperty(result, operation)
    else if (operation.op === 'upsert-object-group') result = upsertObjectGroup(result, operation)
    else if (operation.op === 'upsert-object-by-stable-id') result = upsertObject(result, operation)
    else throw new Error(`Unsupported TMX edit operation: ${String((operation as { op?: unknown }).op)}`)
  }
  parseMap(result)
  return result
}

function setMapProperty(xml: string, operation: SetMapPropertyOperation): string {
  requireName(operation.name, 'map property')
  const map = parseMap(xml)
  const properties = childByName(map, 'properties')
  const serialized = serializeProperty(operation.name, operation.value, operation.type)
  if (!properties) {
    const newline = newlineOf(xml)
    const indent = lineIndent(xml, map.openStart) + ' '
    const block = `${newline}${indent}<properties>${newline}${indent} ${serialized}${newline}${indent}</properties>`
    return insertAt(xml, map.openEnd, block)
  }

  const existing = properties.children.find(child => (
    child.name === 'property' && child.attributes.name === operation.name
  ))
  if (existing) {
    return replaceRange(xml, existing.openStart, existing.closeEnd, serialized)
  }
  return insertChild(xml, properties, `${lineIndent(xml, properties.openStart)} ${serialized}`)
}

function upsertObjectGroup(xml: string, operation: UpsertObjectGroupOperation): string {
  requireName(operation.name, 'object group')
  let map = parseMap(xml)
  const existing = findObjectGroup(map, operation.name)
  if (existing) {
    if (existing.attributes.id) return xml
    const allocation = allocateId(xml, 'nextlayerid', map.children)
    const result = setElementAttribute(xml, existing, 'id', String(allocation.id))
    return setMapCounter(result, 'nextlayerid', allocation.next)
  }

  const allocation = allocateId(xml, 'nextlayerid', map.children)
  xml = setMapCounter(xml, 'nextlayerid', allocation.next)
  map = parseMap(xml)
  const indent = lineIndent(xml, map.openStart) + ' '
  const block = `${indent}<objectgroup id="${allocation.id}" name="${escapeXml(operation.name)}">${newlineOf(xml)}${indent}</objectgroup>`
  return insertChild(xml, map, block)
}

function upsertObject(xml: string, operation: UpsertObjectByStableIdOperation): string {
  requireName(operation.group, 'object group')
  requireName(operation.object.stableId, 'stable ID')
  let map = parseMap(xml)
  let group = findObjectGroup(map, operation.group)
  if (!group) {
    xml = upsertObjectGroup(xml, { op: 'upsert-object-group', name: operation.group })
    map = parseMap(xml)
    group = findObjectGroup(map, operation.group)
  }
  if (!group) throw new Error(`Unable to create object group ${operation.group}`)

  const existing = group.children.find(child => (
    child.name === 'object' && objectStableId(child) === operation.object.stableId
  ))
  let objectId = existing?.attributes.id
  if (!objectId) {
    const allObjects = descendants(map).filter(element => element.name === 'object')
    const allocation = allocateId(xml, 'nextobjectid', allObjects)
    objectId = String(allocation.id)
    xml = setMapCounter(xml, 'nextobjectid', allocation.next)
    map = parseMap(xml)
    group = findObjectGroup(map, operation.group)
    if (!group) throw new Error(`Object group disappeared: ${operation.group}`)
  }

  const indent = `${lineIndent(xml, group.openStart)} `
  const serialized = serializeObject(objectId, operation.object, indent, newlineOf(xml))
  const refreshedExisting = group.children.find(child => (
    child.name === 'object' && objectStableId(child) === operation.object.stableId
  ))
  if (refreshedExisting) {
    return replaceRange(xml, refreshedExisting.openStart, refreshedExisting.closeEnd, serialized.slice(indent.length))
  }
  return insertChild(xml, group, serialized)
}

function serializeObject(id: string, object: TmxObjectSpec, indent: string, newline: string): string {
  const attributes: Array<[string, string | number | undefined]> = [
    ['id', id], ['name', object.name], ['type', object.type],
    ['x', object.x], ['y', object.y], ['width', object.width], ['height', object.height],
    ['rotation', object.rotation],
  ]
  const opening = `${indent}<object${attributes
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([name, value]) => ` ${name}="${escapeXml(formatNumber(value))}"`).join('')}>`
  const propertyEntries: Array<[string, TmxScalar]> = [
    ['stableId', object.stableId],
    ...Object.entries(object.properties ?? {}).filter(([name]) => name !== 'stableId'),
  ]
  propertyEntries.sort(([left], [right]) => (
    left === 'stableId' ? -1 : right === 'stableId' ? 1 : left.localeCompare(right)
  ))
  const propertyIndent = `${indent}  `
  const lines = [opening, `${indent} <properties>`]
  for (const [name, value] of propertyEntries) {
    lines.push(`${propertyIndent}${serializeProperty(name, value)}`)
  }
  lines.push(`${indent} </properties>`)
  if (object.shape?.type === 'ellipse') lines.push(`${indent} <ellipse/>`)
  else if (object.shape) {
    const points = object.shape.points.map(point => `${formatNumber(point[0])},${formatNumber(point[1])}`).join(' ')
    lines.push(`${indent} <${object.shape.type} points="${escapeXml(points)}"/>`)
  }
  lines.push(`${indent}</object>`)
  return lines.join(newline)
}

function serializeProperty(
  name: string,
  value: TmxScalar,
  explicitType?: SetMapPropertyOperation['type'],
): string {
  const type = explicitType ?? inferPropertyType(value)
  const typeAttribute = type === 'string' ? '' : ` type="${type}"`
  return `<property name="${escapeXml(name)}"${typeAttribute} value="${escapeXml(formatScalar(value))}"/>`
}

function inferPropertyType(value: TmxScalar): 'string' | 'int' | 'float' | 'bool' {
  if (typeof value === 'boolean') return 'bool'
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float'
  return 'string'
}

function formatScalar(value: TmxScalar): string {
  return typeof value === 'number' ? formatNumber(value) : String(value)
}

function formatNumber(value: string | number): string {
  if (typeof value === 'string') return value
  if (!Number.isFinite(value)) throw new Error(`TMX numeric value must be finite: ${value}`)
  return Object.is(value, -0) ? '0' : String(value)
}

function insertChild(xml: string, parent: XmlElement, serialized: string): string {
  if (parent.selfClosing) throw new Error(`Cannot insert into self-closing <${parent.name}>`)
  const newline = newlineOf(xml)
  const between = xml.slice(parent.openEnd, parent.closeStart)
  if (!between.includes('\n') && !between.includes('\r')) {
    const parentIndent = lineIndent(xml, parent.openStart)
    return insertAt(xml, parent.closeStart, `${newline}${serialized}${newline}${parentIndent}`)
  }
  const closeLineStart = lineStart(xml, parent.closeStart)
  return insertAt(xml, closeLineStart, `${serialized}${newline}`)
}

function allocateId(xml: string, counter: 'nextlayerid' | 'nextobjectid', elements: XmlElement[]): { id: number, next: number } {
  const map = parseMap(xml)
  const declared = positiveInteger(map.attributes[counter])
  const afterExisting = elements.reduce((maximum, element) => (
    Math.max(maximum, positiveInteger(element.attributes.id) ?? 0)
  ), 0) + 1
  const id = Math.max(declared ?? 1, afterExisting)
  return { id, next: id + 1 }
}

function setMapCounter(xml: string, name: 'nextlayerid' | 'nextobjectid', value: number): string {
  return setElementAttribute(xml, parseMap(xml), name, String(value))
}

function setElementAttribute(xml: string, element: XmlElement, name: string, value: string): string {
  const opening = xml.slice(element.openStart, element.openEnd)
  const pattern = new RegExp(`(\\s${escapeRegExp(name)}\\s*=\\s*)(["'])[^"']*\\2`)
  const replacement = `$1"${escapeXml(value)}"`
  const updated = pattern.test(opening)
    ? opening.replace(pattern, replacement)
    : opening.replace(/\s*\/?>(?=$)/, match => ` ${name}="${escapeXml(value)}"${match}`)
  return replaceRange(xml, element.openStart, element.openEnd, updated)
}

function parseMap(xml: string): XmlElement {
  const roots = parseElements(xml)
  const map = roots.find(element => element.name === 'map')
  if (!map || roots.filter(element => element.name === 'map').length !== 1) throw new Error('TMX map root missing')
  if (map.selfClosing) throw new Error('TMX map must not be self-closing')
  return map
}

function parseElements(xml: string): XmlElement[] {
  const roots: XmlElement[] = []
  const stack: OpenElement[] = []
  let cursor = 0
  while (cursor < xml.length) {
    const start = xml.indexOf('<', cursor)
    if (start < 0) break
    const token = readTag(xml, start)
    cursor = token.end
    if (!token.name) continue
    if (token.closing) {
      const current = stack.pop()
      if (!current || current.name !== token.name) throw new Error(`Invalid TMX XML near </${token.name}>`)
      current.closeStart = token.start
      current.closeEnd = token.end
      continue
    }
    const parent = stack.at(-1)
    const element: OpenElement = {
      name: token.name,
      attributes: token.attributes,
      openStart: token.start,
      openEnd: token.end,
      closeStart: token.selfClosing ? token.start : -1,
      closeEnd: token.selfClosing ? token.end : -1,
      selfClosing: token.selfClosing,
      children: [],
      parent,
    }
    if (parent) parent.children.push(element)
    else roots.push(element)
    if (!token.selfClosing) stack.push(element)
  }
  if (stack.length > 0) throw new Error(`Invalid TMX XML: unclosed <${stack.at(-1)?.name}>`)
  return roots
}

function readTag(xml: string, start: number): TagToken {
  if (xml.startsWith('<!--', start)) return ignoredTag(start, endAfter(xml, '-->', start + 4))
  if (xml.startsWith('<![CDATA[', start)) return ignoredTag(start, endAfter(xml, ']]>', start + 9))
  if (xml.startsWith('<?', start)) return ignoredTag(start, endAfter(xml, '?>', start + 2))
  if (xml.startsWith('<!', start)) return ignoredTag(start, findTagEnd(xml, start + 2))
  const end = findTagEnd(xml, start + 1)
  const content = xml.slice(start + 1, end - 1).trim()
  const closing = content.startsWith('/')
  const body = closing ? content.slice(1).trim() : content
  const selfClosing = !closing && body.endsWith('/')
  const normalized = selfClosing ? body.slice(0, -1).trim() : body
  const name = normalized.match(/^[^\s/>]+/)?.[0] ?? ''
  return {
    name,
    attributes: closing ? {} : parseAttributes(normalized.slice(name.length)),
    start,
    end,
    closing,
    selfClosing,
  }
}

function findTagEnd(xml: string, cursor: number): number {
  let quote = ''
  for (let index = cursor; index < xml.length; index += 1) {
    const character = xml[index]
    if (quote) {
      if (character === quote) quote = ''
    } else if (character === '"' || character === "'") quote = character
    else if (character === '>') return index + 1
  }
  throw new Error('Invalid TMX XML: unterminated tag')
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([^\s=]+)\s*=\s*(["'])(.*?)\2/gs
  for (const match of source.matchAll(pattern)) attributes[match[1]] = decodeXml(match[3])
  return attributes
}

function ignoredTag(start: number, end: number): TagToken {
  return { name: '', attributes: {}, start, end, closing: false, selfClosing: true }
}

function endAfter(xml: string, marker: string, cursor: number): number {
  const end = xml.indexOf(marker, cursor)
  if (end < 0) throw new Error(`Invalid TMX XML: unterminated ${marker}`)
  return end + marker.length
}

function childByName(parent: XmlElement, name: string): XmlElement | undefined {
  return parent.children.find(child => child.name === name)
}

function findObjectGroup(map: XmlElement, name: string): XmlElement | undefined {
  return map.children.find(child => child.name === 'objectgroup' && child.attributes.name === name)
}

function objectStableId(object: XmlElement): string | undefined {
  const properties = childByName(object, 'properties')
  return properties?.children.find(child => (
    child.name === 'property' && child.attributes.name === 'stableId'
  ))?.attributes.value
}

function descendants(element: XmlElement): XmlElement[] {
  return element.children.flatMap(child => [child, ...descendants(child)])
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined
  const result = Number(value)
  return result > 0 && Number.isSafeInteger(result) ? result : undefined
}

function requireName(value: string, context: string): void {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Invalid ${context} name`)
}

function newlineOf(xml: string): string {
  return xml.includes('\r\n') ? '\r\n' : '\n'
}

function lineStart(xml: string, index: number): number {
  return xml.lastIndexOf('\n', Math.max(0, index - 1)) + 1
}

function lineIndent(xml: string, index: number): string {
  return xml.slice(lineStart(xml, index), index).match(/^[\t ]*/)?.[0] ?? ''
}

function insertAt(source: string, index: number, value: string): string {
  return source.slice(0, index) + value + source.slice(index)
}

function replaceRange(source: string, start: number, end: number, value: string): string {
  return source.slice(0, start) + value + source.slice(end)
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function decodeXml(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt);/g, entity => ({
    '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>',
  })[entity] ?? entity)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
