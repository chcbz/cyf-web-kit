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
  validateDocumentUniqueness(parseMap(sourceXml))

  let result = sourceXml
  for (const operation of operations) {
    if (!operation || typeof operation !== 'object') throw new TypeError('Invalid TMX edit operation')
    let candidate: string
    if (operation.op === 'set-map-property') candidate = setMapProperty(result, operation)
    else if (operation.op === 'upsert-object-group') candidate = upsertObjectGroup(result, operation)
    else if (operation.op === 'upsert-object-by-stable-id') candidate = upsertObject(result, operation)
    else throw new Error(`Unsupported TMX edit operation: ${String((operation as { op?: unknown }).op)}`)
    result = candidate
  }
  validateDocumentUniqueness(parseMap(result))
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
  const globalExisting = findObjectByStableId(map, operation.object.stableId)
  if (globalExisting && globalExisting.group.attributes.name !== operation.group) {
    throw new Error(
      `Stable ID ${operation.object.stableId} already belongs to object group ${globalExisting.group.attributes.name ?? '<unnamed>'}`,
    )
  }
  if (!group) {
    xml = upsertObjectGroup(xml, { op: 'upsert-object-group', name: operation.group })
    map = parseMap(xml)
    group = findObjectGroup(map, operation.group)
  }
  if (!group) throw new Error(`Unable to create object group ${operation.group}`)

  const existing = group.children.find(child => (
    child.name === 'object' && objectStableId(child) === operation.object.stableId
  ))
  if (existing) return mergeExistingObject(xml, operation.group, operation.object)

  const allObjects = descendants(map).filter(element => element.name === 'object')
  const allocation = allocateId(xml, 'nextobjectid', allObjects)
  const objectId = String(allocation.id)
  xml = setMapCounter(xml, 'nextobjectid', allocation.next)
  map = parseMap(xml)
  group = findObjectGroup(map, operation.group)
  if (!group) throw new Error(`Object group disappeared: ${operation.group}`)

  const indent = `${lineIndent(xml, group.openStart)} `
  const serialized = serializeObject(objectId, operation.object, indent, newlineOf(xml))
  return insertChild(xml, group, serialized)
}

function mergeExistingObject(xml: string, groupName: string, object: TmxObjectSpec): string {
  const ownedAttributes = [
    ['name', object.name], ['type', object.type], ['x', object.x], ['y', object.y],
    ['width', object.width], ['height', object.height], ['rotation', object.rotation],
  ] as const
  let result = xml
  for (const [name, value] of ownedAttributes) {
    if (value === undefined) continue
    const current = requiredObjectByStableId(result, groupName, object.stableId)
    result = setElementAttribute(result, current, name, formatNumber(value))
  }

  const properties: Array<[string, TmxScalar]> = [
    ['stableId', object.stableId],
    ...Object.entries(object.properties ?? {}).filter(([name]) => name !== 'stableId'),
  ]
  for (const [name, value] of properties) {
    result = upsertObjectProperty(result, groupName, object.stableId, name, value)
  }

  if (object.shape) result = replaceOwnedShape(result, groupName, object.stableId, object.shape)
  return result
}

function upsertObjectProperty(
  xml: string,
  groupName: string,
  stableId: string,
  name: string,
  value: TmxScalar,
): string {
  let object = requiredObjectByStableId(xml, groupName, stableId)
  let properties = childByName(object, 'properties')
  if (!properties) {
    const indent = `${lineIndent(xml, object.openStart)} `
    const block = `${indent}<properties>${newlineOf(xml)}${indent} ${serializeProperty(name, value)}${newlineOf(xml)}${indent}</properties>`
    return insertChild(xml, object, block)
  }

  const matches = properties.children.filter(child => (
    child.name === 'property' && child.attributes.name === name
  ))
  if (matches.length === 0) {
    return insertChild(xml, properties, `${lineIndent(xml, properties.openStart)} ${serializeProperty(name, value)}`)
  }

  let result = xml
  for (const duplicate of matches.slice(1).reverse()) {
    result = removeElementAndLine(result, duplicate)
  }
  object = requiredObjectByStableId(result, groupName, stableId)
  properties = childByName(object, 'properties')
  const property = properties?.children.find(child => (
    child.name === 'property' && child.attributes.name === name
  ))
  if (!property) throw new Error(`Object property disappeared: ${name}`)
  result = setElementAttribute(result, property, 'value', formatScalar(value))
  const refreshed = requiredObjectProperty(result, groupName, stableId, name)
  const type = inferPropertyType(value)
  return type === 'string'
    ? removeElementAttribute(result, refreshed, 'type')
    : setElementAttribute(result, refreshed, 'type', type)
}

function replaceOwnedShape(
  xml: string,
  groupName: string,
  stableId: string,
  shape: NonNullable<TmxObjectSpec['shape']>,
): string {
  let result = xml
  const object = requiredObjectByStableId(result, groupName, stableId)
  const ownedShapes = object.children.filter(child => (
    child.name === 'ellipse' || child.name === 'polygon' || child.name === 'polyline'
  ))
  for (const child of ownedShapes.reverse()) result = removeElementAndLine(result, child)
  const refreshed = requiredObjectByStableId(result, groupName, stableId)
  const indent = `${lineIndent(result, refreshed.openStart)} `
  return insertChild(result, refreshed, indent + serializeShape(shape))
}

function serializeShape(shape: NonNullable<TmxObjectSpec['shape']>): string {
  if (shape.type === 'ellipse') return '<ellipse/>'
  const points = shape.points.map(point => `${formatNumber(point[0])},${formatNumber(point[1])}`).join(' ')
  return `<${shape.type} points="${escapeXml(points)}"/>`
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

function removeElementAttribute(xml: string, element: XmlElement, name: string): string {
  const opening = xml.slice(element.openStart, element.openEnd)
  const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(["']).*?\\1`, 's')
  if (!pattern.test(opening)) return xml
  return replaceRange(xml, element.openStart, element.openEnd, opening.replace(pattern, ''))
}

function removeElementAndLine(xml: string, element: XmlElement): string {
  const start = lineStart(xml, element.openStart)
  const prefix = xml.slice(start, element.openStart)
  const end = element.closeEnd
  const newlineEnd = xml.startsWith('\r\n', end) ? end + 2 : xml[end] === '\n' ? end + 1 : end
  return /^[\t ]*$/.test(prefix)
    ? replaceRange(xml, start, newlineEnd, '')
    : replaceRange(xml, element.openStart, element.closeEnd, '')
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

function findObjectByStableId(map: XmlElement, stableId: string): { group: XmlElement, object: XmlElement } | undefined {
  for (const group of map.children.filter(child => child.name === 'objectgroup')) {
    const object = descendants(group).find(child => child.name === 'object' && objectStableId(child) === stableId)
    if (object) return { group, object }
  }
  return undefined
}

function requiredObjectByStableId(xml: string, groupName: string, stableId: string): XmlElement {
  const group = findObjectGroup(parseMap(xml), groupName)
  const object = group?.children.find(child => child.name === 'object' && objectStableId(child) === stableId)
  if (!object) throw new Error(`Object ${stableId} missing from object group ${groupName}`)
  return object
}

function requiredObjectProperty(xml: string, groupName: string, stableId: string, name: string): XmlElement {
  const object = requiredObjectByStableId(xml, groupName, stableId)
  const property = childByName(object, 'properties')?.children.find(child => (
    child.name === 'property' && child.attributes.name === name
  ))
  if (!property) throw new Error(`Object property ${name} missing from ${stableId}`)
  return property
}

function objectStableId(object: XmlElement): string | undefined {
  const properties = childByName(object, 'properties')
  return properties?.children.find(child => (
    child.name === 'property' && child.attributes.name === 'stableId'
  ))?.attributes.value
}

function validateDocumentUniqueness(map: XmlElement): void {
  rejectDuplicates(
    map.children.filter(child => child.name === 'objectgroup').map(group => group.attributes.name).filter(isString),
    'object group name',
  )
  const mapProperties = childByName(map, 'properties')?.children
    .filter(child => child.name === 'property')
    .map(property => property.attributes.name)
    .filter(isString) ?? []
  rejectDuplicates(mapProperties, 'map property')

  const stableIds: string[] = []
  for (const object of descendants(map).filter(child => child.name === 'object')) {
    const properties = childByName(object, 'properties')
    for (const property of properties?.children ?? []) {
      if (property.name === 'property' && property.attributes.name === 'stableId' && property.attributes.value) {
        stableIds.push(property.attributes.value)
      }
    }
  }
  rejectDuplicates(stableIds, 'stable ID')
}

function rejectDuplicates(values: string[], label: string): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`)
    seen.add(value)
  }
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string'
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
