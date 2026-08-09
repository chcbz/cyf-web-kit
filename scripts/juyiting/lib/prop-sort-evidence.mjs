import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { SaxesParser } from 'saxes'

export const BASE_COMMIT = '7144d9260b3905ce0335d037d3b1a3589d3a88a1'
export const ZERO_GENERATION_ID = '0'.repeat(64)
export const MAP_SCENE_ID = 'juyiting-main'
export const MAP_FLOOR_ID = 'floor-1'
export const RENDER_BAND_ORDER = 100
export const FLOOR_ORDER = 0
export const EVIDENCE_ANIMATION = 'idle'
export const EVIDENCE_DIRECTION = 'down'
export const EVIDENCE_FRAME_ORDINAL = 0
export const REFERENCE_ROLE = 'lujunyi'
export const BOUNTY_ROLES = ['lujunyi', 'husanniang']
export const DIRECTIONS = ['north', 'south', 'west', 'east']

export const EXPECTED_PROP_DEFS = [
  {
    semanticName: 'main-seat', tmxId: 90, tmxName: 'main-seat-rect',
    stableId: 'jyt.prop.center-north.main-seat.v1', chunkId: 'center',
    sortAnchor: { x: 872, y: 268 }, tieBias: 0
  },
  {
    semanticName: 'agent-roster', tmxId: 91, tmxName: 'agent-roster-rect',
    stableId: 'jyt.prop.southwest.agent-roster.v1', chunkId: 'west-lower',
    sortAnchor: { x: 178, y: 737 }, tieBias: 0
  },
  {
    semanticName: 'bounty-board', tmxId: 92, tmxName: 'bounty-board-rect',
    stableId: 'jyt.prop.northeast.bounty-board.v1', chunkId: 'east-upper',
    sortAnchor: { x: 1446, y: 379 }, tieBias: -4
  },
  {
    semanticName: 'library-shelf', tmxId: 93, tmxName: 'library-shelf-rect',
    stableId: 'jyt.prop.southeast.library-shelf.v1', chunkId: 'east-lower',
    sortAnchor: { x: 1558, y: 719 }, tieBias: 0
  },
  {
    semanticName: 'roster-book', tmxId: 94, tmxName: 'roster-book-rect',
    stableId: 'jyt.prop.center-north.roster-book.v1', chunkId: 'center',
    sortAnchor: { x: 306, y: 384 }, tieBias: 0
  }
]

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function readSha256(path) {
  return sha256Bytes(readFileSync(path))
}

function attrs(tag) {
  return Object.fromEntries(Object.entries(tag.attributes).map(([key, value]) => [key, String(value)]))
}

export function parseHallTmx(xml) {
  const data = { mapAttrs: null, tilesets: [], objects: [] }
  const stack = []
  let activeTileset = null
  let activeTile = null

  const parser = new SaxesParser({ xmlns: false, position: false })
  parser.on('opentag', tag => {
    stack.push(tag.name)
    if (tag.name === 'map') data.mapAttrs = attrs(tag)
    if (tag.name === 'tileset') {
      activeTileset = { attrs: attrs(tag), tiles: [], image: null }
    } else if (tag.name === 'tile' && activeTileset) {
      activeTile = { attrs: attrs(tag), image: null }
    } else if (tag.name === 'image' && activeTile) {
      activeTile.image = attrs(tag)
    } else if (tag.name === 'image' && activeTileset) {
      activeTileset.image = attrs(tag)
    } else if (tag.name === 'object' && tag.attributes.type === 'prop') {
      data.objects.push(attrs(tag))
    }
  })
  parser.on('closetag', tag => {
    if (tag.name === 'tile' && activeTileset && activeTile) {
      activeTileset.tiles.push(activeTile)
      activeTile = null
    } else if (tag.name === 'tileset' && activeTileset) {
      data.tilesets.push(activeTileset)
      activeTileset = null
    }
    stack.pop()
  })
  parser.write(xml).close()
  return data
}

export function positiveInteger(value, label) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} must be a positive safe integer, got ${value}`)
  return number
}

export function finiteNumber(value, label) {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite, got ${value}`)
  return number
}

export function resolveHallProps(tmxData) {
  if (!tmxData.mapAttrs) throw new Error('TMX map element missing')
  const map = {
    tilewidth: positiveInteger(tmxData.mapAttrs.tilewidth, 'map.tilewidth'),
    tileheight: positiveInteger(tmxData.mapAttrs.tileheight, 'map.tileheight'),
    width: positiveInteger(tmxData.mapAttrs.width, 'map.width'),
    height: positiveInteger(tmxData.mapAttrs.height, 'map.height')
  }
  map.coordinateWidth = map.tilewidth * map.width
  map.coordinateHeight = map.tileheight * map.height

  const tilesets = tmxData.tilesets.filter(ts => ts.attrs.name === 'hall-props')
  if (tilesets.length !== 1) throw new Error(`expected exactly one hall-props tileset, got ${tilesets.length}`)
  const tileset = tilesets[0]
  const firstgid = positiveInteger(tileset.attrs.firstgid, 'hall-props.firstgid')
  if (tileset.attrs.objectalignment !== 'topleft') throw new Error(`hall-props.objectalignment must be topleft, got ${tileset.attrs.objectalignment}`)
  const tilewidth = positiveInteger(tileset.attrs.tilewidth, 'hall-props.tilewidth')
  const tileheight = positiveInteger(tileset.attrs.tileheight, 'hall-props.tileheight')
  const tilecount = positiveInteger(tileset.attrs.tilecount, 'hall-props.tilecount')
  const columns = positiveInteger(tileset.attrs.columns, 'hall-props.columns')
  if (tilecount !== 5 || columns !== 5) throw new Error(`hall-props tilecount/columns must be 5/5, got ${tilecount}/${columns}`)

  const byGid = new Map()
  for (const tile of tileset.tiles) {
    const tileId = Number(tile.attrs.id)
    if (!Number.isSafeInteger(tileId) || tileId < 0) throw new Error(`hall-props tile id invalid: ${tile.attrs.id}`)
    if (!tile.image) throw new Error(`hall-props tile ${tileId} image missing`)
    const imageWidth = positiveInteger(tile.image.width, `tile ${tileId} image.width`)
    const imageHeight = positiveInteger(tile.image.height, `tile ${tileId} image.height`)
    if (!tile.image.source) throw new Error(`hall-props tile ${tileId} image.source missing`)
    const gid = firstgid + tileId
    if (byGid.has(gid)) throw new Error(`duplicate hall-props gid ${gid}`)
    byGid.set(gid, { gid, tileId, imageSource: tile.image.source, imageWidth, imageHeight })
  }
  if (byGid.size !== 5) throw new Error(`hall-props must contain exactly 5 tiles, got ${byGid.size}`)

  const objects = new Map()
  for (const object of tmxData.objects) {
    const id = Number(object.id)
    if (!Number.isSafeInteger(id)) throw new Error(`prop object id invalid: ${object.id}`)
    if (objects.has(id)) throw new Error(`duplicate prop object id ${id}`)
    const gid = positiveInteger(object.gid, `object ${id}.gid`)
    const tile = byGid.get(gid)
    if (!tile) throw new Error(`object ${id} gid ${gid} does not resolve into hall-props`)
    objects.set(id, {
      id,
      name: object.name,
      type: object.type,
      gid,
      x: finiteNumber(object.x, `object ${id}.x`),
      y: finiteNumber(object.y, `object ${id}.y`),
      width: finiteNumber(object.width, `object ${id}.width`),
      height: finiteNumber(object.height, `object ${id}.height`),
      tile
    })
  }
  return {
    map,
    tileset: {
      name: tileset.attrs.name,
      firstgid,
      tilewidth,
      tileheight,
      tilecount,
      columns,
      objectalignment: tileset.attrs.objectalignment
    },
    objects
  }
}

export function tmxImageSourceToPublicPath(source) {
  if (typeof source !== 'string' || !source.startsWith('images/')) throw new Error(`unsupported hall-props image source: ${source}`)
  return `public/juyiting/${source}`
}

export function propWorldAlphaAabb(propRect, sourceAlphaAabb) {
  return {
    minX: propRect.x + sourceAlphaAabb.minX,
    minY: propRect.y + sourceAlphaAabb.minY,
    maxX: propRect.x + sourceAlphaAabb.maxX,
    maxY: propRect.y + sourceAlphaAabb.maxY
  }
}

export function roleRelativeAlphaAabb(definition, sourceAlphaAabb) {
  const originX = -definition.frame.width * definition.scale * definition.anchor.x
  const originY = -definition.frame.height * definition.scale * definition.anchor.y
  return {
    minX: originX + sourceAlphaAabb.minX * definition.scale,
    minY: originY + sourceAlphaAabb.minY * definition.scale,
    maxX: originX + sourceAlphaAabb.maxX * definition.scale,
    maxY: originY + sourceAlphaAabb.maxY * definition.scale
  }
}

export function translateAabb(relative, point) {
  return {
    minX: relative.minX + point.x,
    minY: relative.minY + point.y,
    maxX: relative.maxX + point.x,
    maxY: relative.maxY + point.y
  }
}

export function intersectsHalfOpen(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
}

export function horizontalGap(propAabb, agentAabb, direction) {
  if (direction === 'west') return propAabb.minX - agentAabb.maxX
  if (direction === 'east') return agentAabb.minX - propAabb.maxX
  return null
}

export function floor256(value) { return Math.floor(value * 256) / 256 }
export function ceil256(value) { return Math.ceil(value * 256) / 256 }

export function westFoot(propAabb, roleRelativeAabbs, guard = 4) {
  const maxAgentRight = Math.max(...roleRelativeAabbs.map(aabb => aabb.maxX))
  return floor256(propAabb.minX - guard - maxAgentRight)
}

export function eastFoot(propAabb, roleRelativeAabbs, guard = 4) {
  const minAgentLeft = Math.min(...roleRelativeAabbs.map(aabb => aabb.minX))
  return ceil256(propAabb.maxX + guard - minAgentLeft)
}

export function worldSortKey(stableId, fixedPointY, tieBias) {
  return {
    renderBandOrder: RENDER_BAND_ORDER,
    floorOrder: FLOOR_ORDER,
    elevation: 0,
    fixedPointY,
    tieBias,
    stableId
  }
}

export function relationFromComparison(agentVsProp) {
  return agentVsProp < 0 ? 'agent<prop' : 'prop<agent'
}

export function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function stableJson(value) {
  return JSON.stringify(value, null, 2)
}
