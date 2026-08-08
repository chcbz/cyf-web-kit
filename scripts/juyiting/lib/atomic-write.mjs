/** Atomic UTF-8 fixture replacement: write, fsync, verify, then rename. */
import { randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function atomicWriteUtf8(path, content, label = 'fixture') {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`
  let descriptor
  let temporaryCreated = false
  try {
    descriptor = openSync(temporaryPath, 'wx')
    temporaryCreated = true
    writeFileSync(descriptor, content, { encoding: 'utf8' })
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    if (readFileSync(temporaryPath, 'utf8') !== content) {
      throw new Error(`${label} temporary write verification failed`)
    }
    renameSync(temporaryPath, path)
    temporaryCreated = false
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    if (temporaryCreated) {
      try { unlinkSync(temporaryPath) } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
  }
}
