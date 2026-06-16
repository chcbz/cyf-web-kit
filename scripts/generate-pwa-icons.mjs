import fs from 'fs'
import path from 'path'
import zlib from 'zlib'

const outputDir = path.resolve('public/pwa')
const rootDir = path.resolve('public')

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[i] = c >>> 0
  }
  return table
})()

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const mix = (start, end, ratio) => {
  const t = clamp(ratio, 0, 1)
  return start + ((end - start) * t)
}

const lerpColor = (from, to, ratio) => (
  from.map((channel, index) => Math.round(mix(channel, to[index], ratio)))
)

const setPixel = (buffer, size, x, y, rgba) => {
  if (x < 0 || y < 0 || x >= size || y >= size) return
  const offset = (y * size + x) * 4
  buffer[offset] = rgba[0]
  buffer[offset + 1] = rgba[1]
  buffer[offset + 2] = rgba[2]
  buffer[offset + 3] = rgba[3]
}

const blendPixel = (buffer, size, x, y, rgba) => {
  if (x < 0 || y < 0 || x >= size || y >= size) return
  const offset = (y * size + x) * 4
  const alpha = rgba[3] / 255
  const inverse = 1 - alpha
  buffer[offset] = Math.round(rgba[0] * alpha + buffer[offset] * inverse)
  buffer[offset + 1] = Math.round(rgba[1] * alpha + buffer[offset + 1] * inverse)
  buffer[offset + 2] = Math.round(rgba[2] * alpha + buffer[offset + 2] * inverse)
  buffer[offset + 3] = Math.round(rgba[3] + buffer[offset + 3] * inverse)
}

const pointInPolygon = (x, y, polygon) => {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0]
    const yi = polygon[i][1]
    const xj = polygon[j][0]
    const yj = polygon[j][1]
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-6) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

const fillPolygon = (buffer, size, polygon, color) => {
  const xs = polygon.map(point => point[0])
  const ys = polygon.map(point => point[1])
  const minX = Math.floor(Math.min(...xs))
  const maxX = Math.ceil(Math.max(...xs))
  const minY = Math.floor(Math.min(...ys))
  const maxY = Math.ceil(Math.max(...ys))

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (pointInPolygon(x + 0.5, y + 0.5, polygon)) {
        blendPixel(buffer, size, x, y, color)
      }
    }
  }
}

const fillCircle = (buffer, size, cx, cy, radius, color) => {
  const minX = Math.floor(cx - radius)
  const maxX = Math.ceil(cx + radius)
  const minY = Math.floor(cy - radius)
  const maxY = Math.ceil(cy + radius)
  const radiusSq = radius * radius

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      if ((dx * dx) + (dy * dy) <= radiusSq) {
        blendPixel(buffer, size, x, y, color)
      }
    }
  }
}

const fillRoundedRect = (buffer, size, left, top, width, height, radius, color, gloss = false) => {
  const right = left + width
  const bottom = top + height
  for (let y = Math.floor(top); y < Math.ceil(bottom); y += 1) {
    for (let x = Math.floor(left); x < Math.ceil(right); x += 1) {
      const clampedX = clamp(x + 0.5, left + radius, right - radius)
      const clampedY = clamp(y + 0.5, top + radius, bottom - radius)
      const dx = (x + 0.5) - clampedX
      const dy = (y + 0.5) - clampedY
      if ((dx * dx) + (dy * dy) <= radius * radius) {
        let pixel = color
        if (gloss) {
          const verticalRatio = (y - top) / height
          const highlight = Math.max(0, 0.18 - verticalRatio * 0.28)
          pixel = [
            clamp(Math.round(color[0] + 255 * highlight), 0, 255),
            clamp(Math.round(color[1] + 210 * highlight), 0, 255),
            clamp(Math.round(color[2] + 160 * highlight), 0, 255),
            color[3]
          ]
        }
        blendPixel(buffer, size, x, y, pixel)
      }
    }
  }
}

const drawRing = (buffer, size, cx, cy, outerRadius, innerRadius, color) => {
  const minX = Math.floor(cx - outerRadius)
  const maxX = Math.ceil(cx + outerRadius)
  const minY = Math.floor(cy - outerRadius)
  const maxY = Math.ceil(cy + outerRadius)
  const outerSq = outerRadius * outerRadius
  const innerSq = innerRadius * innerRadius
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      const distance = (dx * dx) + (dy * dy)
      if (distance <= outerSq && distance >= innerSq) {
        blendPixel(buffer, size, x, y, color)
      }
    }
  }
}

const createIcon = (size, { insetRatio = 0.14, maskable = false } = {}) => {
  const buffer = Buffer.alloc(size * size * 4, 0)
  const center = size / 2
  const inset = size * insetRatio
  const panelSize = size - inset * 2

  const topBg = [117, 32, 29, 255]
  const bottomBg = [58, 17, 16, 255]

  for (let y = 0; y < size; y += 1) {
    const row = lerpColor(topBg, bottomBg, y / (size - 1))
    for (let x = 0; x < size; x += 1) {
      setPixel(buffer, size, x, y, row)
    }
  }

  const panelColor = [132, 30, 30, 255]
  const borderColor = [220, 182, 91, 255]
  const plaqueColor = [242, 226, 190, 255]
  const plaqueShadow = [115, 65, 35, 255]
  const roofColor = [53, 27, 21, 255]
  const accentColor = [226, 199, 124, 255]

  fillRoundedRect(buffer, size, inset, inset, panelSize, panelSize, panelSize * 0.18, panelColor, true)
  drawRing(buffer, size, center, center, panelSize * 0.47, panelSize * 0.43, borderColor)
  fillCircle(buffer, size, center, center, panelSize * 0.3, [245, 235, 212, 255])
  drawRing(buffer, size, center, center, panelSize * 0.305, panelSize * 0.285, [154, 83, 41, 255])

  const roof = [
    [center - panelSize * 0.21, center - panelSize * 0.05],
    [center, center - panelSize * 0.24],
    [center + panelSize * 0.21, center - panelSize * 0.05],
    [center + panelSize * 0.17, center - panelSize * 0.01],
    [center - panelSize * 0.17, center - panelSize * 0.01]
  ]
  fillPolygon(buffer, size, roof, roofColor)

  const eaves = [
    [center - panelSize * 0.25, center - panelSize * 0.015],
    [center + panelSize * 0.25, center - panelSize * 0.015],
    [center + panelSize * 0.19, center + panelSize * 0.045],
    [center - panelSize * 0.19, center + panelSize * 0.045]
  ]
  fillPolygon(buffer, size, eaves, accentColor)

  fillRoundedRect(
    buffer,
    size,
    center - panelSize * 0.17,
    center + panelSize * 0.06,
    panelSize * 0.34,
    panelSize * 0.16,
    panelSize * 0.045,
    plaqueShadow
  )

  fillRoundedRect(
    buffer,
    size,
    center - panelSize * 0.16,
    center + panelSize * 0.045,
    panelSize * 0.32,
    panelSize * 0.16,
    panelSize * 0.04,
    plaqueColor,
    true
  )

  fillRoundedRect(
    buffer,
    size,
    center - panelSize * 0.023,
    center + panelSize * 0.08,
    panelSize * 0.046,
    panelSize * 0.11,
    panelSize * 0.02,
    roofColor
  )

  fillRoundedRect(
    buffer,
    size,
    center - panelSize * 0.105,
    center + panelSize * 0.09,
    panelSize * 0.21,
    panelSize * 0.028,
    panelSize * 0.014,
    roofColor
  )

  fillCircle(buffer, size, center + panelSize * 0.19, center - panelSize * 0.19, panelSize * 0.045, [198, 35, 35, 255])
  fillCircle(buffer, size, center + panelSize * 0.19, center - panelSize * 0.19, panelSize * 0.022, [248, 223, 173, 255])

  if (maskable) {
    drawRing(buffer, size, center, center, panelSize * 0.49, panelSize * 0.47, [244, 222, 167, 255])
  }

  return buffer
}

const uint32 = (value) => {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value >>> 0, 0)
  return buffer
}

const crc32 = (buffer) => {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const createChunk = (type, data) => {
  const typeBuffer = Buffer.from(type)
  const chunkBody = Buffer.concat([typeBuffer, data])
  return Buffer.concat([
    uint32(data.length),
    chunkBody,
    uint32(crc32(chunkBody))
  ])
}

const encodePng = (rgba, width, height) => {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    signature,
    createChunk('IHDR', ihdr),
    createChunk('IDAT', zlib.deflateSync(raw)),
    createChunk('IEND', Buffer.alloc(0))
  ])
}

const encodeIco = (pngBuffer, size) => {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)

  const directory = Buffer.alloc(16)
  directory[0] = size >= 256 ? 0 : size
  directory[1] = size >= 256 ? 0 : size
  directory[2] = 0
  directory[3] = 0
  directory.writeUInt16LE(1, 4)
  directory.writeUInt16LE(32, 6)
  directory.writeUInt32LE(pngBuffer.length, 8)
  directory.writeUInt32LE(22, 12)

  return Buffer.concat([header, directory, pngBuffer])
}

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true })
}

ensureDir(outputDir)
ensureDir(rootDir)

const outputFiles = [
  ['icon-192.png', 192, { insetRatio: 0.14 }],
  ['icon-512.png', 512, { insetRatio: 0.14 }],
  ['icon-maskable-512.png', 512, { insetRatio: 0.05, maskable: true }],
  ['apple-touch-icon.png', 180, { insetRatio: 0.14 }],
  ['favicon-32.png', 32, { insetRatio: 0.12 }]
]

for (const [filename, size, options] of outputFiles) {
  const buffer = encodePng(createIcon(size, options), size, size)
  fs.writeFileSync(path.join(outputDir, filename), buffer)
}

const faviconPng = fs.readFileSync(path.join(outputDir, 'favicon-32.png'))
fs.writeFileSync(path.join(rootDir, 'favicon.ico'), encodeIco(faviconPng, 32))

console.log(`Generated ${outputFiles.length} icons in ${outputDir}`)
