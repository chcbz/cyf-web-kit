/** Atomic UTF-8 fixture replacement with best-effort, non-masking cleanup. */
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  fchmodSync,
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
  fchmodSync,
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
 * Every trusted installed token is frozen from descriptor-bound staging bytes:
 * dev+ino, mode, byte length and SHA-256. Target verification always opens with
 * O_NOFOLLOW and performs fstat-before/read/fstat-after on one descriptor.
 * Installation is no-clobber via same-directory hard links.
 */
export function atomicWriteUtf8Batch(entries, label = 'fixture batch', operationOverrides = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`${label} requires at least one fixture entry`)
  }
  if (constants.O_NOFOLLOW === undefined) {
    throw new Error(`${label} requires fs.constants.O_NOFOLLOW`)
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
    const originalSnapshot = descriptorSnapshotIfPresent(path, `${entry.label ?? label} original destination`, operations)
    const temporaryPath = `${path}.tmp-${transactionId}-${index}`
    const backupPath = `${path}.backup-${transactionId}-${index}`
    assertMissing(temporaryPath, `${label} temporary path`, operations)
    assertMissing(backupPath, `${label} backup path`, operations)
    return {
      path,
      content: entry.content,
      requestBytes: Buffer.from(entry.content, 'utf8'),
      label: entry.label ?? `${label} entry ${index + 1}`,
      originalSnapshot,
      temporaryPath,
      backupPath,
      temporaryCreated: false,
      trustedInstalledToken: null,
      backupCreated: false,
      backupToken: null,
      replacementCommitted: false,
    }
  })

  stageAllItems(items, label, operations)

  try {
    for (const item of items) commitItem(item, operations)
    verifyInstalledBatch(items, 'pre-cleanup final verification', operations)
  } catch (primaryError) {
    const rollbackErrors = []
    for (const item of [...items].reverse()) rollbackItem(item, operations, rollbackErrors)
    for (const item of items) cleanupStagedTemporary(item, operations, rollbackErrors)
    throwWithCleanup(primaryError, rollbackErrors, `${label} commit failed`)
  }

  const cleanupErrors = cleanupCommittedBackups(items, operations)
  let finalVerificationError
  try {
    // Success linearization boundary: on a successful return, this descriptor-
    // bound pass is the final internal filesystem activity.
    verifyInstalledBatch(items, 'success linearization verification', operations)
  } catch (error) {
    finalVerificationError = asError(error)
  }

  if (finalVerificationError) {
    const recoveryErrors = []
    for (const item of items) ensureRecoveryBackup(item, operations, recoveryErrors)
    const rollbackErrors = []
    for (const item of [...items].reverse()) rollbackItem(item, operations, rollbackErrors)
    for (const item of items) cleanupStagedTemporary(item, operations, rollbackErrors)
    throwWithCleanup(
      finalVerificationError,
      [...cleanupErrors, ...recoveryErrors, ...rollbackErrors],
      `${label} final verification failed`,
    )
  }

  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      `${label} committed but backup cleanup failed: ${cleanupErrors.map(error => error.message).join('; ')}`,
    )
  }
}

function stageAllItems(items, label, operations) {
  let descriptor
  let stagingItem
  try {
    for (const item of items) {
      stagingItem = item
      descriptor = operations.openSync(item.temporaryPath, 'wx')
      item.temporaryCreated = true
      operations.writeFileSync(descriptor, item.requestBytes)
      operations.fsyncSync(descriptor)
      const writtenStat = operations.fstatSync(descriptor)
      requireRegularStat(writtenStat, `${item.label} staged descriptor`)
      operations.closeSync(descriptor)
      descriptor = undefined

      const stagedCandidate = descriptorSnapshot(item.temporaryPath, `${item.label} staged temporary`, operations)
      if (!sameInode(stagedCandidate.token, writtenStat)) {
        throw new Error(`${item.label} staged temporary changed inode after close: expected ${formatToken(inodeToken(writtenStat))}, got ${formatToken(stagedCandidate.token)}`)
      }
      assertExpectedContent(stagedCandidate.token, expectedRequestContent(item), `${item.label} staged temporary`)
      item.trustedInstalledToken = Object.freeze({ ...stagedCandidate.token })
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
}

function commitItem(item, operations) {
  if (item.originalSnapshot) {
    verifyFileMatchesToken(
      item.path,
      item.originalSnapshot.token,
      `${item.label} destination changed before batch commit`,
      operations,
    )
    operations.renameSync(item.path, item.backupPath)
    item.backupCreated = true
    const backupCandidate = verifyFileMatchesToken(
      item.backupPath,
      item.originalSnapshot.token,
      `${item.label} backup changed after creation`,
      operations,
    )
    item.backupToken = Object.freeze({ ...backupCandidate.token })
  } else {
    assertMissing(item.path, `${item.label} destination`, operations)
  }

  operations.linkSync(item.temporaryPath, item.path)
  item.replacementCommitted = true
  verifyFileMatchesToken(
    item.path,
    item.trustedInstalledToken,
    `${item.label} installed target changed after hard-link`,
    operations,
  )
  unlinkVerifiedFile(
    item.temporaryPath,
    item.trustedInstalledToken,
    `${item.label} staged temporary cleanup`,
    operations,
  )
  item.temporaryCreated = false
  verifyFileMatchesToken(
    item.path,
    item.trustedInstalledToken,
    `${item.label} installed target changed after staging cleanup`,
    operations,
  )
}

function verifyInstalledBatch(items, phase, operations) {
  for (const item of items) {
    verifyFileMatchesToken(
      item.path,
      item.trustedInstalledToken,
      `${item.label} ${phase}`,
      operations,
    )
  }
}

function cleanupCommittedBackups(items, operations) {
  const errors = []
  for (const item of items) {
    if (!item.backupCreated) continue
    const removed = unlinkVerifiedFileForCleanup(
      item.backupPath,
      item.backupToken,
      `${item.label} committed backup cleanup`,
      operations,
      errors,
    )
    if (removed) item.backupCreated = false
  }
  return errors
}

function rollbackItem(item, operations, errors) {
  if (item.originalSnapshot && !item.backupCreated) {
    errors.push(incompleteRollbackError(
      item,
      'original destination bytes have no verified backup or recovery artifact; current target was preserved',
    ))
    return
  }

  if (item.replacementCommitted) {
    let currentMatches = false
    try {
      verifyFileMatchesToken(
        item.path,
        item.trustedInstalledToken,
        `${item.label} rollback target changed from trusted staged content`,
        operations,
      )
      currentMatches = true
    } catch (error) {
      if (isMissingError(error)) {
        item.replacementCommitted = false
      } else {
        errors.push(incompleteRollbackError(
          item,
          `${asError(error).message}; concurrent target was preserved`,
        ))
        return
      }
    }

    if (currentMatches) {
      try {
        operations.unlinkSync(item.path)
        item.replacementCommitted = false
      } catch (error) {
        errors.push(incompleteRollbackError(item, `could not remove transaction-installed target: ${asError(error).message}`))
        return
      }
    }
  }

  if (item.backupCreated) restoreBackupNoClobber(item, operations, errors)
}

function restoreBackupNoClobber(item, operations, errors) {
  try {
    verifyFileMatchesToken(
      item.backupPath,
      item.backupToken,
      `${item.label} rollback backup changed`,
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
    verifyFileMatchesToken(
      item.path,
      item.backupToken,
      `${item.label} restored target changed`,
      operations,
    )
  } catch (error) {
    errors.push(incompleteRollbackError(item, asError(error).message))
    return
  }

  const backupCleanupErrors = []
  const removed = unlinkVerifiedFileForCleanup(
    item.backupPath,
    item.backupToken,
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

function ensureRecoveryBackup(item, operations, errors) {
  if (!item.originalSnapshot || item.backupCreated) return

  let descriptor
  let created = false
  try {
    descriptor = operations.openSync(
      item.backupPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      item.originalSnapshot.token.mode & 0o7777,
    )
    created = true
    operations.fchmodSync(descriptor, item.originalSnapshot.token.mode & 0o7777)
    operations.writeFileSync(descriptor, item.originalSnapshot.bytes)
    operations.fsyncSync(descriptor)
    const writtenStat = operations.fstatSync(descriptor)
    requireRegularStat(writtenStat, `${item.label} recovery backup descriptor`)
    operations.closeSync(descriptor)
    descriptor = undefined

    const recoveryCandidate = descriptorSnapshot(item.backupPath, `${item.label} recovery backup`, operations)
    if (!sameInode(recoveryCandidate.token, writtenStat)) {
      throw new Error(`${item.label} recovery backup changed inode after close`)
    }
    assertSameContentAndMode(
      recoveryCandidate.token,
      item.originalSnapshot.token,
      `${item.label} recovery backup content mismatch`,
    )
    item.backupToken = Object.freeze({ ...recoveryCandidate.token })
    item.backupCreated = true
  } catch (primaryError) {
    const cleanupErrors = []
    if (descriptor !== undefined) {
      try { operations.closeSync(descriptor) } catch (error) { cleanupErrors.push(asError(error)) }
    }
    if (created) unlinkForCleanup(item.backupPath, operations, cleanupErrors)
    const primary = asError(primaryError)
    errors.push(new AggregateError(
      [primary, ...cleanupErrors],
      `${item.label} could not rebuild intentional recovery artifact at ${item.backupPath}: ${primary.message}${cleanupErrors.length ? `; cleanup also failed: ${cleanupErrors.map(error => error.message).join('; ')}` : ''}`,
    ))
  }
}

function cleanupStagedTemporary(item, operations, errors) {
  if (!item.temporaryCreated) return
  if (!item.trustedInstalledToken) {
    unlinkForCleanup(item.temporaryPath, operations, errors)
    return
  }
  const removed = unlinkVerifiedFileForCleanup(
    item.temporaryPath,
    item.trustedInstalledToken,
    `${item.label} staged temporary cleanup`,
    operations,
    errors,
  )
  if (removed) item.temporaryCreated = false
}

function descriptorSnapshotIfPresent(path, label, operations) {
  try {
    return descriptorSnapshot(path, label, operations)
  } catch (error) {
    if (isMissingError(error)) return null
    throw error
  }
}

function descriptorSnapshot(path, label, operations) {
  let descriptor
  let primaryError
  let captured
  try {
    descriptor = operations.openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const before = operations.fstatSync(descriptor)
    requireRegularStat(before, `${label} descriptor before read`)
    const bytes = operations.readFileSync(descriptor)
    const after = operations.fstatSync(descriptor)
    requireRegularStat(after, `${label} descriptor after read`)
    if (!stableReadStat(before, after)) {
      throw new Error(`${label} changed during descriptor-bound read: before=${formatStat(before)} after=${formatStat(after)}`)
    }
    if (bytes.length !== after.size) {
      throw new Error(`${label} descriptor byte length mismatch: stat=${after.size}, read=${bytes.length}`)
    }
    captured = {
      bytes,
      token: Object.freeze(contentToken(after, bytes)),
    }
  } catch (error) {
    primaryError = asError(error)
  }

  let closeError
  if (descriptor !== undefined) {
    try { operations.closeSync(descriptor) } catch (error) { closeError = asError(error) }
  }
  if (primaryError && closeError) {
    throw new AggregateError([primaryError, closeError], `${label} verification failed: ${primaryError.message}; close also failed: ${closeError.message}`)
  }
  if (primaryError) throw primaryError
  if (closeError) throw closeError
  return captured
}

function verifyFileMatchesToken(path, expectedToken, label, operations) {
  const candidate = descriptorSnapshot(path, label, operations)
  if (!sameTrustedToken(candidate.token, expectedToken)) {
    throw new Error(`${label}: expected ${formatToken(expectedToken)}, got ${formatToken(candidate.token)} at ${path}`)
  }
  return candidate
}

function expectedRequestContent(item) {
  return {
    lengthBytes: item.requestBytes.length,
    sha256: sha256(item.requestBytes),
  }
}

function assertExpectedContent(actualToken, expectedContent, label) {
  if (actualToken.lengthBytes !== expectedContent.lengthBytes || actualToken.sha256 !== expectedContent.sha256) {
    throw new Error(`${label} content mismatch: expected length=${expectedContent.lengthBytes},sha256=${expectedContent.sha256}; got length=${actualToken.lengthBytes},sha256=${actualToken.sha256}`)
  }
}

function assertSameContentAndMode(actualToken, expectedToken, label) {
  if (
    actualToken.mode !== expectedToken.mode
    || actualToken.lengthBytes !== expectedToken.lengthBytes
    || actualToken.sha256 !== expectedToken.sha256
  ) {
    throw new Error(`${label}: expected ${formatToken(expectedToken)}, got ${formatToken(actualToken)}`)
  }
}

function contentToken(stat, bytes) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    lengthBytes: bytes.length,
    sha256: sha256(bytes),
  }
}

function inodeToken(statOrToken) {
  return { dev: statOrToken.dev, ino: statOrToken.ino }
}

function sameInode(left, right) {
  return Boolean(left && right && left.dev === right.dev && left.ino === right.ino)
}

function sameTrustedToken(left, right) {
  return Boolean(
    sameInode(left, right)
    && left.mode === right.mode
    && left.lengthBytes === right.lengthBytes
    && left.sha256 === right.sha256
  )
}

function stableReadStat(left, right) {
  return Boolean(
    left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
  )
}

function formatToken(token) {
  if (!token) return '<unrecorded>'
  return `dev=${String(token.dev)},ino=${String(token.ino)},mode=${String(token.mode)},length=${String(token.lengthBytes)},sha256=${String(token.sha256)}`
}

function formatStat(stat) {
  return `dev=${String(stat.dev)},ino=${String(stat.ino)},mode=${String(stat.mode)},size=${String(stat.size)},mtimeMs=${String(stat.mtimeMs)},ctimeMs=${String(stat.ctimeMs)}`
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function requireRegularStat(stat, label) {
  if (!stat?.isFile?.()) throw new Error(`${label} is not a regular file`)
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

function unlinkVerifiedFile(path, token, label, operations) {
  verifyFileMatchesToken(path, token, `${label} verification`, operations)
  operations.unlinkSync(path)
}

function unlinkVerifiedFileForCleanup(path, token, label, operations, errors) {
  try {
    unlinkVerifiedFile(path, token, label, operations)
    return true
  } catch (error) {
    if (isMissingError(error)) return true
    errors.push(asError(error))
    return false
  }
}

function incompleteRollbackError(item, reason) {
  const recovery = item.backupCreated
    ? `; intentional recovery artifact retained at ${item.backupPath}`
    : ''
  return new Error(`Unable to complete rollback for ${item.label} at ${item.path}: ${reason}${recovery}`)
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

function isMissingError(error) {
  if (error?.code === 'ENOENT') return true
  return error instanceof AggregateError && error.errors.some(isMissingError)
}

function asError(error) {
  return error instanceof Error ? error : new Error(String(error))
}
