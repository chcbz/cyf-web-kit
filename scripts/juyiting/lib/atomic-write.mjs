/** Atomic UTF-8 fixture replacement with best-effort, non-masking cleanup. */
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fstatSync,
  fsyncSync,
  linkSync,
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
  fstatSync,
  fsyncSync,
  linkSync,
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
 * Installation uses same-directory hard links so a concurrently recreated
 * target fails with EEXIST instead of being overwritten. Rollback removes only
 * a target whose dev+ino still matches this transaction's installed inode.
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
    const originalStat = regularDestinationOrMissing(path, entry.label ?? label, operations)
    const temporaryPath = `${path}.tmp-${transactionId}-${index}`
    const backupPath = `${path}.backup-${transactionId}-${index}`
    assertMissing(temporaryPath, `${label} temporary path`, operations)
    assertMissing(backupPath, `${label} backup path`, operations)
    return {
      path,
      content: entry.content,
      label: entry.label ?? `${label} entry ${index + 1}`,
      originalIdentity: originalStat ? fileIdentity(originalStat) : null,
      temporaryPath,
      backupPath,
      temporaryCreated: false,
      stagedIdentity: null,
      backupCreated: false,
      backupIdentity: null,
      replacementCommitted: false,
      trustedInstalledIdentity: null,
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
      const descriptorStat = operations.fstatSync(descriptor)
      requireRegularStat(descriptorStat, `${item.label} staged descriptor`)
      item.stagedIdentity = Object.freeze(fileIdentity(descriptorStat))
      item.trustedInstalledIdentity = Object.freeze(inodeIdentity(descriptorStat))
      operations.closeSync(descriptor)
      descriptor = undefined
      requireIdentityAtPath(
        item.temporaryPath,
        item.stagedIdentity,
        `${item.label} staged temporary file changed identity`,
        operations,
      )
      if (operations.readFileSync(item.temporaryPath, 'utf8') !== item.content) {
        throw new Error(`${item.label} temporary write verification failed`)
      }
      requireIdentityAtPath(
        item.temporaryPath,
        item.stagedIdentity,
        `${item.label} staged temporary file changed identity after verification`,
        operations,
      )
    }
  } catch (primaryError) {
    const cleanupErrors = []
    if (descriptor !== undefined) {
      try { operations.closeSync(descriptor) } catch (error) { cleanupErrors.push(asError(error)) }
      descriptor = undefined
    }
    for (const item of items) cleanupStagedTemporary(item, operations, cleanupErrors)
    throwWithCleanup(primaryError, cleanupErrors, `${stagingItem?.label ?? label} staging failed`)
  }

  try {
    for (const item of items) {
      if (item.originalIdentity) {
        requireIdentityAtPath(
          item.path,
          item.originalIdentity,
          `${item.label} destination changed before batch commit`,
          operations,
        )
        operations.renameSync(item.path, item.backupPath)
        item.backupCreated = true
        const backupStat = requireRegularPath(item.backupPath, `${item.label} backup after creation`, operations)
        const backupIdentity = fileIdentity(backupStat)
        if (!sameInode(backupIdentity, item.originalIdentity)) {
          throw new Error(`${item.label} backup changed inode after creation: expected ${formatIdentity(item.originalIdentity)}, got ${formatIdentity(backupIdentity)} at ${item.backupPath}`)
        }
        item.backupIdentity = backupIdentity
      } else {
        assertMissing(item.path, `${item.label} destination`, operations)
      }

      // Hard-link installation is atomic and no-clobber: EEXIST preserves any
      // target concurrently recreated after the original moved to backup.
      operations.linkSync(item.temporaryPath, item.path)
      item.replacementCommitted = true
      const linkedTargetCandidate = fileIdentity(requireRegularPath(
        item.path,
        `${item.label} installed target after hard-link`,
        operations,
      ))
      if (!sameInode(linkedTargetCandidate, item.trustedInstalledIdentity)) {
        throw new Error(`${item.label} installed target changed inode after hard-link: expected ${formatIdentity(item.trustedInstalledIdentity)}, got ${formatIdentity(linkedTargetCandidate)} at ${item.path}`)
      }
      unlinkExpectedInode(
        item.temporaryPath,
        item.trustedInstalledIdentity,
        `${item.label} staged temporary cleanup`,
        operations,
      )
      item.temporaryCreated = false
      const postUnlinkTargetCandidate = fileIdentity(requireRegularPath(
        item.path,
        `${item.label} installed target after staging cleanup`,
        operations,
      ))
      if (!sameInode(postUnlinkTargetCandidate, item.trustedInstalledIdentity)) {
        throw new Error(`${item.label} installed target changed inode after staging cleanup: expected ${formatIdentity(item.trustedInstalledIdentity)}, got ${formatIdentity(postUnlinkTargetCandidate)} at ${item.path}`)
      }
    }
  } catch (primaryError) {
    const rollbackErrors = []
    for (const item of [...items].reverse()) rollbackItem(item, operations, rollbackErrors)
    for (const item of items) cleanupStagedTemporary(item, operations, rollbackErrors)
    throwWithCleanup(primaryError, rollbackErrors, `${label} commit failed`)
  }

  const cleanupErrors = []
  for (const item of items) {
    if (item.backupCreated) {
      const removed = unlinkExpectedPathForCleanup(
        item.backupPath,
        item.backupIdentity,
        `${item.label} committed backup cleanup`,
        operations,
        cleanupErrors,
      )
      if (removed) item.backupCreated = false
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, `${label} committed but backup cleanup failed: ${cleanupErrors.map(error => error.message).join('; ')}`)
  }
}

function rollbackItem(item, operations, errors) {
  if (item.replacementCommitted) {
    const current = lstatIfPresent(item.path, operations, errors, `${item.label} rollback target inspection`)
    if (current) {
      const currentIdentity = fileIdentity(current)
      if (!sameInode(currentIdentity, item.trustedInstalledIdentity)) {
        errors.push(incompleteRollbackError(
          item,
          `target changed from trusted staged inode ${formatIdentity(item.trustedInstalledIdentity)} to ${formatIdentity(currentIdentity)}; concurrent target was preserved`,
        ))
        return
      }
      try {
        operations.unlinkSync(item.path)
        item.replacementCommitted = false
      } catch (error) {
        errors.push(incompleteRollbackError(item, `could not remove transaction-installed target: ${asError(error).message}`))
        return
      }
    } else {
      item.replacementCommitted = false
    }
  }

  if (item.backupCreated) restoreBackupNoClobber(item, operations, errors)
}

function restoreBackupNoClobber(item, operations, errors) {
  try {
    requireIdentityAtPath(
      item.backupPath,
      item.backupIdentity,
      `${item.label} rollback backup changed identity`,
      operations,
    )
  } catch (error) {
    errors.push(incompleteRollbackError(item, asError(error).message))
    return
  }

  try {
    operations.linkSync(item.backupPath, item.path)
  } catch (error) {
    const cause = asError(error)
    errors.push(incompleteRollbackError(
      item,
      cause.code === 'EEXIST'
        ? 'concurrent target occupies the destination; concurrent target was preserved and the old backup cannot be restored'
        : `backup no-clobber restore failed: ${cause.message}`,
    ))
    return
  }

  try {
    requireInodeAtPath(
      item.path,
      item.backupIdentity,
      `${item.label} restored target changed inode`,
      operations,
    )
  } catch (error) {
    errors.push(incompleteRollbackError(item, asError(error).message))
    return
  }

  const backupCleanupErrors = []
  const removed = unlinkExpectedInodeForCleanup(
    item.backupPath,
    item.backupIdentity,
    `${item.label} restored backup cleanup`,
    operations,
    backupCleanupErrors,
  )
  if (removed) {
    item.backupCreated = false
  } else {
    for (const error of backupCleanupErrors) {
      errors.push(incompleteRollbackError(item, `restored target but backup cleanup failed: ${error.message}`))
    }
  }
}

function cleanupStagedTemporary(item, operations, errors) {
  if (!item.temporaryCreated) return
  const removed = unlinkExpectedInodeForCleanup(
    item.temporaryPath,
    item.stagedIdentity,
    `${item.label} staged temporary cleanup`,
    operations,
    errors,
  )
  if (removed) item.temporaryCreated = false
}

function regularDestinationOrMissing(path, label, operations) {
  try {
    const stat = operations.lstatSync(path)
    requireRegularStat(stat, `${label} destination`)
    return stat
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function requireRegularStat(stat, label) {
  if (!stat?.isFile?.()) throw new Error(`${label} is not a regular file`)
}


function requireRegularPath(path, label, operations) {
  let stat
  try {
    stat = operations.lstatSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${label}: missing ${path}`)
    throw error
  }
  requireRegularStat(stat, `${label}: ${path}`)
  return stat
}

function requireInodeAtPath(path, expectedIdentity, message, operations) {
  const stat = requireRegularPath(path, message, operations)
  const actualIdentity = fileIdentity(stat)
  if (!sameInode(actualIdentity, expectedIdentity)) {
    throw new Error(`${message}: expected ${formatIdentity(expectedIdentity)}, got ${formatIdentity(actualIdentity)} at ${path}`)
  }
  return stat
}

function requireIdentityAtPath(path, expectedIdentity, message, operations) {
  let stat
  try {
    stat = operations.lstatSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${message}: missing ${path}`)
    throw error
  }
  requireRegularStat(stat, `${message}: ${path}`)
  const actualIdentity = fileIdentity(stat)
  if (!sameIdentity(actualIdentity, expectedIdentity)) {
    throw new Error(`${message}: expected ${formatIdentity(expectedIdentity)}, got ${formatIdentity(actualIdentity)} at ${path}`)
  }
  return stat
}

function lstatIfPresent(path, operations, errors, label) {
  try {
    const stat = operations.lstatSync(path)
    requireRegularStat(stat, `${label}: ${path}`)
    return stat
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    errors.push(asError(error))
    return null
  }
}

function fileIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  }
}

function inodeIdentity(statOrIdentity) {
  return { dev: statOrIdentity.dev, ino: statOrIdentity.ino }
}

function sameInode(left, right) {
  return Boolean(left && right && left.dev === right.dev && left.ino === right.ino)
}

function sameIdentity(left, right) {
  return Boolean(
    sameInode(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
  )
}

function formatIdentity(identity) {
  if (!identity) return '<unrecorded>'
  return `dev=${String(identity.dev)},ino=${String(identity.ino)},size=${String(identity.size)},mtimeMs=${String(identity.mtimeMs)},ctimeMs=${String(identity.ctimeMs)}`
}

function incompleteRollbackError(item, reason) {
  const recovery = item.backupCreated
    ? `; intentional recovery artifact retained at ${item.backupPath}`
    : ''
  return new Error(`Unable to complete rollback for ${item.label} at ${item.path}: ${reason}${recovery}`)
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

function unlinkExpectedPath(path, expectedIdentity, label, operations) {
  requireIdentityAtPath(path, expectedIdentity, `${label} identity mismatch`, operations)
  operations.unlinkSync(path)
}

function unlinkExpectedInode(path, expectedIdentity, label, operations) {
  requireInodeAtPath(path, expectedIdentity, `${label} inode mismatch`, operations)
  operations.unlinkSync(path)
}

function unlinkExpectedPathForCleanup(path, expectedIdentity, label, operations, errors) {
  try {
    unlinkExpectedPath(path, expectedIdentity, label, operations)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return true
    errors.push(asError(error))
    return false
  }
}

function unlinkExpectedInodeForCleanup(path, expectedIdentity, label, operations, errors) {
  try {
    unlinkExpectedInode(path, expectedIdentity, label, operations)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return true
    errors.push(asError(error))
    return false
  }
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
