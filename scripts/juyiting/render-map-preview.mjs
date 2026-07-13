import { randomUUID } from 'node:crypto'
import {
  mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SaxesParser } from 'saxes'

import { validateMapRuntime } from '../../src/game/map/mapValidation.ts'
import { renderMapPreview } from '../../src/game/map/tmxPreviewRenderer.ts'
import { parseMovementTmx } from '../../src/game/map/tmxMovementParser.ts'

// CLI contract: no arguments checks both committed previews; --update atomically replaces the pair.
const tmxPath = process.env.JIA_JUYITING_TMX_PATH
  ?? fileURLToPath(new URL('../../public/juyiting/hall.tmx', import.meta.url))
const outputDirectory = process.env.JIA_JUYITING_PREVIEW_DIR
  ?? fileURLToPath(new URL('../../docs/assets/juyiting/map-preview/', import.meta.url))
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
  const clean = renderMapPreview(runtime, { debug: false, art })
  const debug = renderMapPreview(runtime, { debug: true, art })
  validateSvg(clean, 'clean preview')
  validateSvg(debug, 'debug preview')

  if (update) atomicWritePair([
    { path: cleanPath, content: clean, label: 'Juyiting clean preview' },
    { path: debugPath, content: debug, label: 'Juyiting debug preview' },
  ])
  else {
    compareArtifact(cleanPath, clean, 'Juyiting clean preview')
    compareArtifact(debugPath, debug, 'Juyiting debug preview')
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

function compareArtifact(path, actual, label) {
  let expected
  try {
    expected = readFileSync(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`${label} is missing. Run npm run preview:juyiting-map -- --update.`)
    }
    throw new Error(`Unable to read preview at ${path}: ${errorCode(error)}`)
  }
  if (actual !== expected) {
    throw new Error(`${label} mismatch. Review the TMX/art change, then run npm run preview:juyiting-map -- --update.`)
  }
}

function atomicWritePair(artifacts) {
  for (const artifact of artifacts) mkdirSync(dirname(artifact.path), { recursive: true })
  const existing = artifacts.map(artifact => existingFile(artifact.path, artifact.label))
  const suffix = `${process.pid}-${randomUUID()}`
  const states = artifacts.map((artifact, index) => ({
    ...artifact,
    existed: existing[index],
    temporaryPath: `${artifact.path}.tmp-${suffix}`,
    backupPath: `${artifact.path}.bak-${suffix}`,
    backupCreated: false,
    installed: false,
  }))
  try {
    for (const state of states) {
      writeFileSync(state.temporaryPath, state.content, { encoding: 'utf8', flag: 'wx' })
      if (readFileSync(state.temporaryPath, 'utf8') !== state.content) {
        throw new Error(`${state.label} temporary write verification failed.`)
      }
      validateSvg(readFileSync(state.temporaryPath, 'utf8'), `${state.label} temporary file`)
    }
    for (const state of states) {
      if (state.existed) {
        renameSync(state.path, state.backupPath)
        state.backupCreated = true
      }
    }
    for (const state of states) {
      renameSync(state.temporaryPath, state.path)
      state.installed = true
    }
    for (const state of states) {
      if (state.backupCreated) {
        try { unlinkSync(state.backupPath); state.backupCreated = false } catch {}
      }
    }
  } catch (error) {
    for (const state of [...states].reverse()) {
      if (state.installed) safeUnlink(state.path)
    }
    for (const state of [...states].reverse()) {
      if (state.backupCreated) {
        try { renameSync(state.backupPath, state.path); state.backupCreated = false } catch {}
      }
    }
    throw error
  } finally {
    for (const state of states) {
      safeUnlink(state.temporaryPath)
    }
  }
}

function existingFile(path, label) {
  try {
    const stat = statSync(path)
    if (!stat.isFile()) throw new Error(`${label} path is not a regular file: ${path}`)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
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

function safeUnlink(path) {
  try { unlinkSync(path) } catch (error) { if (error?.code !== 'ENOENT' && error?.code !== 'EISDIR' && error?.code !== 'EPERM') throw error }
}

function errorCode(error) {
  return error?.code ? `${error.code}: ${error.message}` : String(error)
}
