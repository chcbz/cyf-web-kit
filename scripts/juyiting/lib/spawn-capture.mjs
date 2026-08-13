import { spawnSync } from 'node:child_process'
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function closeDescriptor(descriptor) {
  if (descriptor === undefined) return
  try { closeSync(descriptor) } catch {}
}

/**
 * Run a synchronous child process without Node pipe/socket stdio. Restricted
 * hosts can deny pipe shutdown even after a successful child exit; regular
 * temporary files preserve the real command, bytes, status, signal and error.
 */
export function spawnSyncCaptured(command, args = [], options = {}) {
  const {
    encoding = null,
    input,
    maxBuffer = 64 * 1024 * 1024,
    ...spawnOptions
  } = options
  const directory = mkdtempSync(join(tmpdir(), 'cyf-spawn-capture-'))
  const stdinPath = join(directory, 'stdin.bin')
  const stdoutPath = join(directory, 'stdout.bin')
  const stderrPath = join(directory, 'stderr.bin')
  let stdinFd
  let stdoutFd
  let stderrFd
  try {
    if (input !== undefined && input !== null) {
      writeFileSync(stdinPath, input)
      stdinFd = openSync(stdinPath, 'r')
    }
    stdoutFd = openSync(stdoutPath, 'w')
    stderrFd = openSync(stderrPath, 'w')
    const result = spawnSync(command, [...args], {
      ...spawnOptions,
      stdio: [stdinFd ?? 'ignore', stdoutFd, stderrFd],
    })
    closeDescriptor(stdinFd); stdinFd = undefined
    closeDescriptor(stdoutFd); stdoutFd = undefined
    closeDescriptor(stderrFd); stderrFd = undefined

    const stdoutBytes = readFileSync(stdoutPath)
    const stderrBytes = readFileSync(stderrPath)
    if (stdoutBytes.length > maxBuffer || stderrBytes.length > maxBuffer) {
      const error = new RangeError(`Captured child output exceeded maxBuffer=${maxBuffer}`)
      error.code = 'ENOBUFS'
      return { ...result, stdout: encoding ? '' : Buffer.alloc(0), stderr: encoding ? '' : Buffer.alloc(0), error }
    }
    return {
      ...result,
      stdout: encoding ? stdoutBytes.toString(encoding) : stdoutBytes,
      stderr: encoding ? stderrBytes.toString(encoding) : stderrBytes,
    }
  } finally {
    closeDescriptor(stdinFd)
    closeDescriptor(stdoutFd)
    closeDescriptor(stderrFd)
    rmSync(directory, { recursive: true, force: true })
  }
}

/** execFileSync-compatible wrapper backed by regular-file capture. */
export function execFileSyncCaptured(command, args = [], options = {}) {
  const result = spawnSyncCaptured(command, args, options)
  if (result.error || result.status !== 0) {
    const error = result.error ?? new Error(
      `Command failed with status ${result.status}: ${command} ${args.join(' ')}`,
    )
    error.status = result.status
    error.signal = result.signal
    error.stdout = result.stdout
    error.stderr = result.stderr
    throw error
  }
  return result.stdout
}
