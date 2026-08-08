/** Atomic UTF-8 fixture replacement with best-effort, non-masking cleanup. */
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'

const defaultAtomicOperations = {
  randomUUID,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
}

export function atomicWriteUtf8(path, content, label = 'fixture', operationOverrides = {}) {
  const operations = { ...defaultAtomicOperations, ...operationOverrides }
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
    if (temporaryCreated) unlinkForCleanup(temporaryPath, operations, cleanupErrors)
    throwWithCleanup(primaryError, cleanupErrors, `${label} replacement failed`)
  }
}

/**
 * Transactionally replaces a batch of UTF-8 fixtures.
 *
 * All targets are staged, fsynced and verified before any destination changes.
 * Commit failures restore every already-touched destination from a sibling
 * backup (or remove it when the original was absent), then clean staged files.
 */
export function atomicWriteUtf8Batch(entries, label = 'fixture batch', operationOverrides = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`${label} requires at least one fixture entry`)
  }
  const operations = { ...defaultAtomicOperations, ...operationOverrides }
  const transactionId = `${process.pid}-${operations.randomUUID()}`
  const seenPaths = new Set()
  const items = entries.map((entry, index) => {
    if (!entry || typeof entry.path !== 'string' || typeof entry.content !== 'string') {
      throw new Error(`${label} entry ${index} must contain string path and content`)
    }
    const path = resolve(entry.path)
    if (seenPaths.has(path)) throw new Error(`${label} contains duplicate destination: ${path}`)
    seenPaths.add(path)
    operations.mkdirSync(dirname(path), { recursive: true })
    const originalExists = destinationIsRegularFileOrMissing(path, entry.label ?? label, operations)
    const temporaryPath = `${path}.tmp-${transactionId}-${index}`
    const backupPath = `${path}.backup-${transactionId}-${index}`
    assertMissing(temporaryPath, `${label} temporary path`, operations)
    assertMissing(backupPath, `${label} backup path`, operations)
    return {
      path,
      content: entry.content,
      label: entry.label ?? `${label} entry ${index + 1}`,
      originalExists,
      temporaryPath,
      backupPath,
      temporaryCreated: false,
      backupCreated: false,
      replacementCommitted: false,
    }
  })

  let descriptor
  let stagingItem
  try {
    for (const item of items) {
      stagingItem = item
      descriptor = operations.openSync(item.temporaryPath, 'wx')
      item.temporaryCreated = true
      operations.writeFileSync(descriptor, item.content, { encoding: 'utf8' })
      operations.fsyncSync(descriptor)
      operations.closeSync(descriptor)
      descriptor = undefined
      if (operations.readFileSync(item.temporaryPath, 'utf8') !== item.content) {
        throw new Error(`${item.label} temporary write verification failed`)
      }
    }
  } catch (primaryError) {
    const cleanupErrors = []
    if (descriptor !== undefined) {
      try { operations.closeSync(descriptor) } catch (error) { cleanupErrors.push(asError(error)) }
      descriptor = undefined
    }
    for (const item of items) {
      if (item.temporaryCreated) unlinkForCleanup(item.temporaryPath, operations, cleanupErrors)
    }
    throwWithCleanup(primaryError, cleanupErrors, `${stagingItem?.label ?? label} staging failed`)
  }

  try {
    for (const item of items) {
      if (item.originalExists) {
        requireRegularDestination(item.path, item.label, operations)
        operations.renameSync(item.path, item.backupPath)
        item.backupCreated = true
      } else {
        assertMissing(item.path, `${item.label} destination`, operations)
      }
      operations.renameSync(item.temporaryPath, item.path)
      item.temporaryCreated = false
      item.replacementCommitted = true
    }
  } catch (primaryError) {
    const rollbackErrors = []
    for (const item of [...items].reverse()) {
      if (item.replacementCommitted) {
        unlinkForCleanup(item.path, operations, rollbackErrors)
        item.replacementCommitted = false
      }
      if (item.backupCreated) {
        try {
          operations.renameSync(item.backupPath, item.path)
          item.backupCreated = false
        } catch (error) {
          rollbackErrors.push(asError(error))
        }
      }
    }
    for (const item of items) {
      if (item.temporaryCreated) unlinkForCleanup(item.temporaryPath, operations, rollbackErrors)
    }
    throwWithCleanup(primaryError, rollbackErrors, `${label} commit failed`)
  }

  const cleanupErrors = []
  for (const item of items) {
    if (item.backupCreated) {
      unlinkForCleanup(item.backupPath, operations, cleanupErrors)
      item.backupCreated = false
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, `${label} committed but backup cleanup failed: ${cleanupErrors.map(error => error.message).join('; ')}`)
  }
}

function destinationIsRegularFileOrMissing(path, label, operations) {
  try {
    const stat = operations.lstatSync(path)
    if (!stat.isFile()) throw new Error(`${label} destination is not a regular file: ${path}`)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function requireRegularDestination(path, label, operations) {
  let stat
  try {
    stat = operations.lstatSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${label} destination disappeared before batch commit: ${path}`)
    throw error
  }
  if (!stat.isFile()) throw new Error(`${label} destination changed to a non-regular file before batch commit: ${path}`)
}

function assertMissing(path, label, operations) {
  try {
    operations.lstatSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  throw new Error(`${label} already exists: ${path}`)
}

function unlinkForCleanup(path, operations, errors) {
  try { operations.unlinkSync(path) } catch (error) {
    if (error?.code !== 'ENOENT') errors.push(asError(error))
  }
}

function throwWithCleanup(primaryError, cleanupErrors, prefix) {
  if (cleanupErrors.length > 0) {
    const primary = asError(primaryError)
    throw new AggregateError(
      [primary, ...cleanupErrors],
      `${prefix}: ${primary.message}; cleanup/rollback also failed: ${cleanupErrors.map(error => error.message).join('; ')}`,
    )
  }
  throw primaryError
}

function asError(error) {
  return error instanceof Error ? error : new Error(String(error))
}
