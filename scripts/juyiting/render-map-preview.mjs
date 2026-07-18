import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SaxesParser } from 'saxes'

import { validateMapRuntime } from '../../src/game/map/mapValidation.ts'
import { renderMapPreview } from '../../src/game/map/tmxPreviewRenderer.ts'
import { parseMovementTmx } from '../../src/game/map/tmxMovementParser.ts'
import { atomicReplaceFile } from './validate-map.mjs'

// CLI contract: no arguments checks both committed previews; --update atomically replaces each file.
// The shared content-set ID makes a process interruption between the two portable replaces detectable.
const tmxPath = process.env.JIA_JUYITING_TMX_PATH
  ?? fileURLToPath(new URL('../../public/juyiting/hall.tmx', import.meta.url))
const outputDirectory = process.env.JIA_JUYITING_PREVIEW_DIR
  ?? fileURLToPath(new URL('../../tests/fixtures/juyiting/map-preview/', import.meta.url))
const cleanPath = join(outputDirectory, 'hall-clean.svg')
const debugPath = join(outputDirectory, 'hall-debug.svg')

try {
  const update = parseArguments(process.argv.slice(2))
  const tmx = readRequiredText(tmxPath, 'Juyiting TMX source')
  const runtime = parseMovementTmx(tmx)
  const validation = validateMapRuntime(runtime)
  if (!validation.valid) {
    const details = validation.errors.map(error => `${error.code}: ${error.technicalMessage ?? error.userMessage}`).join('\n')
    throw new Error(`Juyiting map validation failed:\n${details}`)
  }

  const art = loadPreviewArt(tmx, tmxPath, runtime.width, runtime.height)
  const generationId = createGenerationId(runtime, art)
  const clean = renderMapPreview(runtime, { debug: false, art, generationId })
  const debug = renderMapPreview(runtime, { debug: true, art, generationId })
  validateSvg(clean, 'clean preview')
  validateSvg(debug, 'debug preview')

  if (update) {
    // Each direct rename is atomic. A process stop between these calls can only create a detectable mixed pair.
    atomicReplaceFile(cleanPath, clean, 'Juyiting clean preview')
    atomicReplaceFile(debugPath, debug, 'Juyiting debug preview')
  }
  else {
    const committedClean = readPreviewArtifact(cleanPath, 'Juyiting clean preview')
    const committedDebug = readPreviewArtifact(debugPath, 'Juyiting debug preview')
    verifyGenerationPair(committedClean, committedDebug, generationId)
    compareArtifact(committedClean, clean, 'Juyiting clean preview')
    compareArtifact(committedDebug, debug, 'Juyiting debug preview')
  }

  console.log('Juyiting map previews valid')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

function parseArguments(args) {
  if (args.length === 0) return false
  if (args.length === 1 && args[0] === '--update') return true
  throw new Error(`Unknown arguments: ${args.join(' ')}`)
}

function loadPreviewArt(tmx, sourcePath, mapWidth, mapHeight) {
  const references = parseArtReferences(tmx)
  const fullMapTilesets = references.filter(reference => {
    return reference.kind === 'tileset' && reference.width === mapWidth && reference.height === mapHeight
  })
  if (fullMapTilesets.length === 0) {
    throw new Error('TMX preview art is unsupported: no inline full-map tileset image reference was found.')
  }
  const selected = [...fullMapTilesets, ...references.filter(reference => reference.kind === 'image-layer')]
  return selected.map(reference => ({
    stableId: `${reference.kind}:${reference.name}`,
    href: localImageDataUri(reference.source, sourcePath),
    x: reference.x,
    y: reference.y,
    width: reference.width,
    height: reference.height,
    opacity: reference.opacity,
  }))
}

function createGenerationId(runtime, art) {
  const provisionalId = '0'.repeat(64)
  const clean = renderMapPreview(runtime, { debug: false, art, generationId: provisionalId })
  const debug = renderMapPreview(runtime, { debug: true, art, generationId: provisionalId })
  return createHash('sha256').update(clean).update('\0').update(debug).digest('hex')
}

function parseArtReferences(tmx) {
  const references = []
  const stack = []
  const parser = new SaxesParser()
  parser.on('opentag', tag => {
    const attributes = Object.fromEntries(Object.entries(tag.attributes).map(([name, value]) => [name, String(value)]))
    const parent = stack.at(-1)
    if (tag.name === 'tileset' && parent?.name === 'map' && attributes.source) {
      throw new Error(`Unsupported external TSX preview art reference: ${attributes.source}`)
    }
    if (tag.name === 'image' && parent?.name === 'tileset') {
      references.push(artReference('tileset', parent.attributes.name ?? 'unnamed', attributes, parent.attributes))
    } else if (tag.name === 'image' && parent?.name === 'imagelayer') {
      if (parent.attributes.visible !== '0') {
        references.push(artReference('image-layer', parent.attributes.name ?? 'unnamed', attributes, parent.attributes))
      }
    }
    stack.push({ name: tag.name, attributes })
  })
  parser.on('closetag', () => { stack.pop() })
  try {
    parser.write(tmx).close()
  } catch (error) {
    if (error instanceof Error && /preview art reference|preview art/i.test(error.message)) throw error
    throw new Error(`Unable to parse TMX art references: ${error instanceof Error ? error.message : String(error)}`)
  }
  return references
}

function artReference(kind, name, imageAttributes, ownerAttributes) {
  const source = imageAttributes.source
  if (!source) throw new Error(`TMX ${kind} ${name} has no image source.`)
  return {
    kind,
    name,
    source,
    x: finiteNumber(ownerAttributes.offsetx ?? ownerAttributes.x ?? 0, `${kind} ${name} x`),
    y: finiteNumber(ownerAttributes.offsety ?? ownerAttributes.y ?? 0, `${kind} ${name} y`),
    width: positiveNumber(imageAttributes.width, `${kind} ${name} image width`),
    height: positiveNumber(imageAttributes.height, `${kind} ${name} image height`),
    opacity: finiteNumber(ownerAttributes.opacity ?? 1, `${kind} ${name} opacity`),
  }
}

function localImageDataUri(source, sourcePath) {
  if (isAbsolute(source) || /^[a-z][a-z\d+.-]*:/i.test(source)) {
    throw new Error(`Unsupported non-local map art reference: ${source}`)
  }
  const mimeType = imageMimeType(source)
  const imagePath = resolve(dirname(sourcePath), source)
  let bytes
  try {
    bytes = readFileSync(imagePath)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Referenced map art is missing: ${source} (${imagePath})`)
    throw new Error(`Unable to read referenced map art ${source}: ${errorCode(error)}`)
  }
  return `data:${mimeType};base64,${bytes.toString('base64')}`
}

function imageMimeType(source) {
  const extension = extname(source).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  throw new Error(`Unsupported map art format for ${source}. Supported formats: PNG, JPEG, WebP.`)
}

function readPreviewArtifact(path, label) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`${label} is missing. Run npm run preview:juyiting-map -- --update.`)
    }
    throw new Error(`Unable to read preview at ${path}: ${errorCode(error)}`)
  }
}

function verifyGenerationPair(clean, debug, expectedGenerationId) {
  const cleanGenerationId = previewGenerationId(clean, 'clean')
  const debugGenerationId = previewGenerationId(debug, 'debug')
  if (cleanGenerationId !== debugGenerationId) {
    throw new Error(`Juyiting preview generation mismatch: clean=${cleanGenerationId}, debug=${debugGenerationId}. Run npm run preview:juyiting-map -- --update.`)
  }
  if (cleanGenerationId !== expectedGenerationId) {
    throw new Error(`Juyiting preview generation mismatch: committed=${cleanGenerationId}, expected=${expectedGenerationId}. Run npm run preview:juyiting-map -- --update.`)
  }
}

function previewGenerationId(svg, label) {
  const match = svg.match(/data-generation-id="([a-f0-9]{64})"/)
  if (!match) throw new Error(`Juyiting ${label} preview generation ID is missing or invalid. Run npm run preview:juyiting-map -- --update.`)
  return match[1]
}

function compareArtifact(expected, actual, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch. Review the TMX/art change, then run npm run preview:juyiting-map -- --update.`)
  }
}

function validateSvg(svg, label) {
  try { new SaxesParser({ xmlns: true }).write(svg).close() } catch (error) {
    throw new Error(`Generated ${label} is invalid SVG: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function readRequiredText(path, label) {
  try { return readFileSync(path, 'utf8') } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${label} is missing: ${path}`)
    throw new Error(`Unable to read ${label} at ${path}: ${errorCode(error)}`)
  }
}

function finiteNumber(value, label) {
  const result = Number(value)
  if (!Number.isFinite(result)) throw new Error(`Invalid ${label}: ${value}`)
  return result
}

function positiveNumber(value, label) {
  const result = finiteNumber(value, label)
  if (!(result > 0)) throw new Error(`Invalid ${label}: ${value}`)
  return result
}

function errorCode(error) {
  return error?.code ? `${error.code}: ${error.message}` : String(error)
}
