import { randomUUID } from 'node:crypto'
import {
  closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateMapRuntime } from '../../src/game/map/mapValidation.ts'
import { createMapSnapshot, serializeMapSnapshot } from '../../src/game/map/tmxSnapshot.ts'
import { parseMovementTmx } from '../../src/game/map/tmxMovementParser.ts'

const defaultAtomicOperations = {
  randomUUID,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
}

// CLI contract: no arguments checks the committed snapshot; --update atomically replaces it.
export function runValidateMap(args = process.argv.slice(2), environment = process.env) {
  const update = parseArguments(args)
  const tmxPath = environment.JIA_JUYITING_TMX_PATH
    ?? fileURLToPath(new URL('../../public/juyiting/hall.tmx', import.meta.url))
  const snapshotPath = environment.JIA_JUYITING_SNAPSHOT_PATH
    ?? fileURLToPath(new URL('../../tests/fixtures/juyiting/hall-map.snapshot.json', import.meta.url))
  const runtime = parseMovementTmx(readRequiredFile(tmxPath, 'Juyiting TMX source'))
  const validation = validateMapRuntime(runtime)
  if (!validation.valid) {
    const details = validation.errors.map(error => `${error.code}: ${error.technicalMessage ?? error.userMessage}`).join('\n')
    throw new Error(`Juyiting map validation failed:\n${details}`)
  }

  const actual = serializeMapSnapshot(createMapSnapshot(runtime))
  if (update) atomicReplaceFile(snapshotPath, actual, 'Juyiting map snapshot')
  else {
    const expected = readArtifact(snapshotPath, 'Juyiting map snapshot', 'snapshot')
    if (actual !== expected) {
      throw new Error('Juyiting map snapshot mismatch. Review the TMX change, then run npm run validate:juyiting-map -- --update.')
    }
  }

  console.log('Juyiting map valid')
}

export function atomicReplaceFile(path, content, label, operations = defaultAtomicOperations) {
  operations.mkdirSync(dirname(path), { recursive: true })
  ensureDestinationFileOrMissing(path, label, operations)
  const temporaryPath = `${path}.tmp-${process.pid}-${operations.randomUUID()}`
  let descriptor
  let temporaryCreated = false
  try {
    descriptor = operations.openSync(temporaryPath, 'wx')
    temporaryCreated = true
    operations.writeFileSync(descriptor, content, { encoding: 'utf8' })
    operations.fsyncSync(descriptor)
    operations.closeSync(descriptor)
    descriptor = undefined
    if (operations.readFileSync(temporaryPath, 'utf8') !== content) {
      throw new Error(`${label} temporary write verification failed.`)
    }
    operations.renameSync(temporaryPath, path)
    temporaryCreated = false
  } catch (primaryError) {
    const cleanupErrors = []
    if (descriptor !== undefined) {
      try { operations.closeSync(descriptor) } catch (error) { cleanupErrors.push(asError(error)) }
      descriptor = undefined
    }
    if (temporaryCreated) {
      try { operations.unlinkSync(temporaryPath) } catch (error) {
        if (error?.code !== 'ENOENT') cleanupErrors.push(asError(error))
      }
    }
    if (cleanupErrors.length > 0) {
      const primary = asError(primaryError)
      throw new AggregateError(
        [primary, ...cleanupErrors],
        `${label} replacement failed: ${primary.message}; cleanup also failed: ${cleanupErrors.map(error => error.message).join('; ')}`,
      )
    }
    throw primaryError
  }
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

function ensureDestinationFileOrMissing(path, label, operations) {
  try {
    const stat = operations.statSync(path)
    if (!stat.isFile()) throw new Error(`${label} path is not a regular file: ${path}`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

function asError(error) {
  return error instanceof Error ? error : new Error(String(error))
}

function errorCode(error) {
  return error?.code ? `${error.code}: ${error.message}` : String(error)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runValidateMap() } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
