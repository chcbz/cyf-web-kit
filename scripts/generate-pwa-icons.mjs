import fs from 'fs'
import path from 'path'
import { PNG } from 'pngjs'

const workspaceRoot = path.resolve('.')
const sourcePath = path.join(workspaceRoot, 'src/assets/branding/fanlibao-mascot-source.png')
const publicDir = path.join(workspaceRoot, 'public')
const outputDir = path.join(publicDir, 'pwa')
const logoPath = path.join(workspaceRoot, 'src/assets/logo.png')
const faviconPath = path.join(publicDir, 'favicon.ico')
const assetVersion = 'shuihu-v2'

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true })
}

const readPng = (filePath) => PNG.sync.read(fs.readFileSync(filePath))

const writePng = (png, filePath) => {
  fs.writeFileSync(filePath, PNG.sync.write(png))
}

const sampleBilinear = (image, x, y) => {
  const { width, height, data } = image
  const clampedX = Math.max(0, Math.min(width - 1, x))
  const clampedY = Math.max(0, Math.min(height - 1, y))
  const x0 = Math.floor(clampedX)
  const y0 = Math.floor(clampedY)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = clampedX - x0
  const ty = clampedY - y0

  const colorAt = (px, py) => {
    const offset = (py * width + px) * 4
    return [
      data[offset],
      data[offset + 1],
      data[offset + 2],
      data[offset + 3]
    ]
  }

  const c00 = colorAt(x0, y0)
  const c10 = colorAt(x1, y0)
  const c01 = colorAt(x0, y1)
  const c11 = colorAt(x1, y1)

  return c00.map((channel, index) => {
    const top = channel * (1 - tx) + c10[index] * tx
    const bottom = c01[index] * (1 - tx) + c11[index] * tx
    return Math.round(top * (1 - ty) + bottom * ty)
  })
}

const resizePng = (image, size) => {
  const result = new PNG({ width: size, height: size })
  const scaleX = image.width / size
  const scaleY = image.height / size

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sourceX = (x + 0.5) * scaleX - 0.5
      const sourceY = (y + 0.5) * scaleY - 0.5
      const [r, g, b, a] = sampleBilinear(image, sourceX, sourceY)
      const offset = (y * size + x) * 4
      result.data[offset] = r
      result.data[offset + 1] = g
      result.data[offset + 2] = b
      result.data[offset + 3] = a
    }
  }

  return result
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

if (!fs.existsSync(sourcePath)) {
  throw new Error(`Missing source mascot: ${sourcePath}`)
}

ensureDir(outputDir)

const source = readPng(sourcePath)
const targets = [
  [`icon-192-${assetVersion}.png`, 192],
  [`icon-512-${assetVersion}.png`, 512],
  [`icon-maskable-512-${assetVersion}.png`, 512],
  [`apple-touch-icon-${assetVersion}.png`, 180],
  [`favicon-32-${assetVersion}.png`, 32]
]

for (const [filename, size] of targets) {
  writePng(resizePng(source, size), path.join(outputDir, filename))
}

writePng(resizePng(source, 200), logoPath)

const faviconPng = PNG.sync.write(resizePng(source, 32))
fs.writeFileSync(faviconPath, encodeIco(faviconPng, 32))

console.log(`Generated ${targets.length} PWA icons and refreshed logo from ${sourcePath}`)
