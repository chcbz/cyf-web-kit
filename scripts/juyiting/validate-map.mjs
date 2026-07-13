import { randomUUID } from 'node:crypto'
import {
  mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateMapRuntime } from '../../src/game/map/mapValidation.ts'
import { createMapSnapshot, serializeMapSnapshot } from '../../src/game/map/tmxSnapshot.ts'
import { parseMovementTmx } from '../../src/game/map/tmxMovementParser.ts'

// CLI contract: no arguments checks the committed snapshot; --update atomically replaces it.
const tmxPath = process.env.JIA_JUYITING_TMX_PATH
  ?? fileURLToPath(new URL('../../public/juyiting/hall.tmx', import.meta.url))
const snapshotPath = process.env.JIA_JUYITING_SNAPSHOT_PATH
  ?? fileURLToPath(new URL('../../tests/fixtures/juyiting/hall-map.snapshot.json', import.meta.url))

try {
  const update = parseArguments(process.argv.slice(2))
  const runtime = parseMovementTmx(readRequiredFile(tmxPath, 'Juyiting TMX source'))
  const validation = validateMapRuntime(runtime)
  if (!validation.valid) {
    const details = validation.errors.map(error => `${error.code}: ${error.technicalMessage ?? error.userMessage}`).join('\n')
    throw new Error(`Juyiting map validation failed:\n${details}`)
  }

  const actual = serializeMapSnapshot(createMapSnapshot(runtime))
  if (update) atomicWrite(snapshotPath, actual, 'Juyiting map snapshot')
  else {
    const expected = readArtifact(snapshotPath, 'Juyiting map snapshot', 'snapshot')
    if (actual !== expected) {
      throw new Error('Juyiting map snapshot mismatch. Review the TMX change, then run npm run validate:juyiting-map -- --update.')
    }
  }

  console.log('Juyiting map valid')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

function parseArguments(args) {
  if (args.length === 0) return false
  if (args.length === 1 && args[0] === '--update') return true
  throw new Error(`Unknown arguments: ${args.join(' ')}`)
}

function readRequiredFile(path, label) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${label} is missing: ${path}`)
    throw new Error(`Unable to read ${label} at ${path}: ${errorCode(error)}`)
  }
}

function readArtifact(path, label, shortName) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`${label} is missing. Run npm run validate:juyiting-map -- --update.`)
    }
    throw new Error(`Unable to read ${shortName} at ${path}: ${errorCode(error)}`)
  }
}

function atomicWrite(path, content, label) {
  mkdirSync(dirname(path), { recursive: true })
  const existing = existingFile(path, label)
  const suffix = `${process.pid}-${randomUUID()}`
  const temporaryPath = `${path}.tmp-${suffix}`
  const backupPath = `${path}.bak-${suffix}`
  let backupCreated = false
  let installed = false
  try {
    writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx' })
    if (readFileSync(temporaryPath, 'utf8') !== content) throw new Error(`${label} temporary write verification failed.`)
    if (existing) {
      renameSync(path, backupPath)
      backupCreated = true
    }
    renameSync(temporaryPath, path)
    installed = true
    if (backupCreated) {
      try { unlinkSync(backupPath); backupCreated = false } catch {}
    }
  } catch (error) {
    if (installed) safeUnlink(path)
    if (backupCreated) {
      try { renameSync(backupPath, path); backupCreated = false } catch {}
    }
    throw error
  } finally {
    safeUnlink(temporaryPath)
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

function safeUnlink(path) {
  try { unlinkSync(path) } catch (error) { if (error?.code !== 'ENOENT') throw error }
}

function errorCode(error) {
  return error?.code ? `${error.code}: ${error.message}` : String(error)
}
