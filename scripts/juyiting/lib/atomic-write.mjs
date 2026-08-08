/** Atomic UTF-8 fixture replacement with best-effort, non-masking cleanup. */
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

const defaultAtomicOperations = {
  randomUUID,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
}

export function atomicWriteUtf8(path, content, label = 'fixture', operations = defaultAtomicOperations) {
  operations.mkdirSync(dirname(path), { recursive: true })
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
      throw new Error(`${label} temporary write verification failed`)
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

function asError(error) {
  return error instanceof Error ? error : new Error(String(error))
}
