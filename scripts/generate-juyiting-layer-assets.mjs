import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const imagesDir = join(rootDir, 'public', 'juyiting', 'images')
const propsDir = join(imagesDir, 'props')
const sourcePath = join(imagesDir, 'liangshan-hall-bg-v2.png')

const source = PNG.sync.read(readFileSync(sourcePath))
const { width, height } = source

const pointInPolygon = (x, y, polygon) => {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0]
    const yi = polygon[i][1]
    const xj = polygon[j][0]
    const yj = polygon[j][1]
    const intersects = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
    if (intersects) inside = !inside
  }
  return inside
}

const inAnyPolygon = (x, y, polygons) => polygons.some(polygon => pointInPolygon(x, y, polygon))

const copyPixel = (target, index, alpha = 255) => {
  target.data[index] = source.data[index]
  target.data[index + 1] = source.data[index + 1]
  target.data[index + 2] = source.data[index + 2]
  target.data[index + 3] = alpha
}

const blank = () => new PNG({ width, height, colorType: 6 })

const writePng = (relativePath, png) => {
  const outputPath = join(imagesDir, relativePath)
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, PNG.sync.write(png))
  console.log(`wrote ${relativePath}`)
}

const writeSourceCopy = (relativePath) => {
  const png = blank()
  for (let i = 0; i < source.data.length; i += 4) {
    copyPixel(png, i, 255)
  }
  writePng(relativePath, png)
}

const writeMaskedLayer = (relativePath, polygons, alpha = 255) => {
  const png = blank()
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!inAnyPolygon(x, y, polygons)) continue
      copyPixel(png, (width * y + x) * 4, alpha)
    }
  }
  writePng(relativePath, png)
}

const writeLightingOverlay = () => {
  const png = blank()
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (width * y + x) * 4
      const r = source.data[index]
      const g = source.data[index + 1]
      const b = source.data[index + 2]
      const warm = Math.max(0, r - b * 0.8, g - b * 0.55)
      const brightness = (r + g + b) / 3
      const alpha = Math.max(0, Math.min(92, Math.round((warm - 28) * 0.9 + (brightness - 118) * 0.35)))
      if (alpha <= 0) continue
      png.data[index] = Math.min(255, r + 36)
      png.data[index + 1] = Math.min(255, g + 24)
      png.data[index + 2] = Math.max(0, b - 6)
      png.data[index + 3] = alpha
    }
  }
  writePng('liangshan-hall-lighting-overlay-v2.png', png)
}

const midOccluders = [
  [[690, 105], [1000, 104], [1044, 348], [628, 350], [620, 184]],
  [[440, 98], [668, 100], [654, 312], [468, 318]],
  [[1018, 98], [1268, 100], [1275, 322], [1028, 318]],
  [[615, 166], [680, 170], [675, 515], [602, 515]],
  [[1168, 168], [1234, 164], [1246, 520], [1168, 516]],
  [[392, 198], [438, 200], [442, 558], [386, 558]],
  [[1420, 160], [1476, 166], [1472, 454], [1408, 454]],
  [[118, 120], [360, 136], [355, 318], [88, 322]],
  [[1302, 122], [1570, 122], [1578, 326], [1290, 332]]
]

const foregroundOccluders = [
  [[0, 710], [474, 700], [540, 941], [0, 941]],
  [[615, 718], [1062, 718], [1088, 941], [595, 941]],
  [[1160, 702], [1672, 684], [1672, 941], [1105, 941]],
  [[348, 386], [462, 390], [500, 760], [342, 758]],
  [[1220, 390], [1332, 390], [1348, 750], [1192, 760]],
  [[0, 365], [92, 360], [108, 650], [0, 670]],
  [[1572, 330], [1672, 342], [1672, 646], [1550, 636]]
]

const props = [
  {
    path: 'props/liangshan-hall-prop-main-seat-v2.png',
    polygons: [
      [[718, 94], [982, 96], [1052, 346], [626, 352], [634, 182]]
    ]
  },
  {
    path: 'props/liangshan-hall-prop-bounty-board-v2.png',
    polygons: [
      [[1294, 126], [1568, 124], [1574, 315], [1286, 322]]
    ]
  },
  {
    path: 'props/liangshan-hall-prop-library-shelf-v2.png',
    polygons: [
      [[1242, 492], [1586, 450], [1606, 727], [1208, 762]]
    ]
  },
  {
    path: 'props/liangshan-hall-prop-agent-roster-v2.png',
    polygons: [
      [[92, 414], [388, 392], [424, 642], [68, 704]]
    ]
  },
  {
    path: 'props/liangshan-hall-prop-gate-v2.png',
    polygons: [
      [[618, 718], [1064, 718], [1092, 941], [592, 941]]
    ]
  }
]

mkdirSync(propsDir, { recursive: true })
writeSourceCopy('liangshan-hall-base-clean-v2.png')
writeMaskedLayer('liangshan-hall-mid-occluders-v2.png', midOccluders)
writeMaskedLayer('liangshan-hall-foreground-occluders-v2.png', foregroundOccluders)
writeLightingOverlay()
props.forEach(prop => writeMaskedLayer(prop.path, prop.polygons))
