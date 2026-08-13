import { spawnSync, type SpawnSyncOptions } from 'node:child_process'
import {
  closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface CapturedSpawnResult {
  readonly status: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
  readonly error?: Error
}

/**
 * Capture child output through regular files instead of Node IPC socket pairs.
 * The production command and exit status remain unchanged, while restricted
 * hosts that deny socket shutdown can still report stdout/stderr faithfully.
 */
export function spawnSyncCaptured(
  command: string,
  args: readonly string[],
  options: Omit<SpawnSyncOptions, 'stdio' | 'encoding'> = {},
): CapturedSpawnResult {
  const directory = mkdtempSync(join(tmpdir(), 'cyf-spawn-capture-'))
  const stdinPath = join(directory, 'stdin.bin')
  const stdoutPath = join(directory, 'stdout.log')
  const stderrPath = join(directory, 'stderr.log')
  let stdinFd: number | undefined
  let stdoutFd: number | undefined
  let stderrFd: number | undefined
  try {
    const { input, ...spawnOptions } = options
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
    if (stdinFd !== undefined) {
      closeSync(stdinFd)
      stdinFd = undefined
    }
    closeSync(stdoutFd)
    stdoutFd = undefined
    closeSync(stderrFd)
    stderrFd = undefined
    return {
      status: result.status,
      signal: result.signal,
      stdout: readFileSync(stdoutPath, 'utf8'),
      stderr: readFileSync(stderrPath, 'utf8'),
      ...(result.error ? { error: result.error } : {}),
    }
  } finally {
    if (stdinFd !== undefined) try { closeSync(stdinFd) } catch { /* best-effort cleanup */ }
    if (stdoutFd !== undefined) try { closeSync(stdoutFd) } catch { /* best-effort cleanup */ }
    if (stderrFd !== undefined) try { closeSync(stderrFd) } catch { /* best-effort cleanup */ }
    rmSync(directory, { recursive: true, force: true })
  }
}
