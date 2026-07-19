export type MovementCommand = {
  commandId: string
  agentId: string
  personaCode: string
  source: 'backend' | 'local' | 'user'
  type: 'MOVE_TO_REGION' | 'RETURN_HOME'
  targetRegionId: string
  priority: number
  stateVersion: number
  startedAt: string
  expectedArrivalAt?: string
  expiresAt?: string
}

export type MovementCommandPushResult =
  | { accepted: true; replacedCommandId?: string }
  | { accepted: false; reason: 'duplicate-command-id' | 'stale-state-version' | 'invalid-command' | 'lower-priority' }

export type MovementCommandQueue = {
  readonly size: number
  push(command: MovementCommand): MovementCommandPushResult
  peek(): MovementCommand | null
  shift(): MovementCommand | null
  snapshot(): MovementCommand[]
  clearPending(agentId?: string): number
  reset(agentId?: string): number
  /** @deprecated Use clearPending() to preserve replay watermarks explicitly. */
  clear(agentId?: string): number
}

export function createMovementCommandQueue(): MovementCommandQueue {
  const pending: MovementCommand[] = []
  const seenCommandAgents = new Map<string, string>()
  const latestStateVersion = new Map<string, number>()

  const removePending = (agentId?: string): number => {
    if (agentId === undefined) {
      const removed = pending.length
      pending.length = 0
      return removed
    }
    let removed = 0
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      if (pending[index]?.agentId === agentId) {
        pending.splice(index, 1)
        removed += 1
      }
    }
    return removed
  }

  return {
    get size() {
      return pending.length
    },

    push(source) {
      if (!validCommand(source)) return { accepted: false, reason: 'invalid-command' }
      if (seenCommandAgents.has(source.commandId)) {
        return { accepted: false, reason: 'duplicate-command-id' }
      }
      const watermark = latestStateVersion.get(source.agentId)
      if (source.source !== 'local' && watermark !== undefined && source.stateVersion <= watermark) {
        return { accepted: false, reason: 'stale-state-version' }
      }

      const command = copyCommand(source)
      const replacedIndex = pending.findIndex(item => item.agentId === command.agentId)
      const replacedCommandId = replacedIndex >= 0 ? pending[replacedIndex]?.commandId : undefined
      if (replacedIndex >= 0) pending.splice(replacedIndex, 1)
      pending.push(command)
      pending.sort(compareCommands)
      seenCommandAgents.set(command.commandId, command.agentId)
      if (command.source !== 'local') latestStateVersion.set(command.agentId, command.stateVersion)
      return replacedCommandId === undefined
        ? { accepted: true }
        : { accepted: true, replacedCommandId }
    },

    peek() {
      return pending[0] ? copyCommand(pending[0]) : null
    },

    shift() {
      const command = pending.shift()
      return command ? copyCommand(command) : null
    },

    snapshot() {
      return pending.map(copyCommand)
    },

    clearPending(agentId) {
      return removePending(agentId)
    },

    reset(agentId) {
      const removed = removePending(agentId)
      if (agentId === undefined) {
        seenCommandAgents.clear()
        latestStateVersion.clear()
        return removed
      }
      latestStateVersion.delete(agentId)
      for (const [commandId, ownerAgentId] of seenCommandAgents) {
        if (ownerAgentId === agentId) seenCommandAgents.delete(commandId)
      }
      return removed
    },

    clear(agentId) {
      return removePending(agentId)
    },
  }
}

function validCommand(command: MovementCommand | null | undefined): command is MovementCommand {
  if (!command || !nonBlank(command.commandId) || !nonBlank(command.agentId)
    || !nonBlank(command.personaCode) || !nonBlank(command.targetRegionId)
    || !nonBlank(command.startedAt)) return false
  if (!['backend', 'local', 'user'].includes(command.source)) return false
  if (!['MOVE_TO_REGION', 'RETURN_HOME'].includes(command.type)) return false
  if (!Number.isFinite(command.priority)
    || !Number.isSafeInteger(command.stateVersion) || command.stateVersion < 0) return false
  const startedAt = Date.parse(command.startedAt)
  if (!Number.isFinite(startedAt)) return false
  const expectedArrivalAt = optionalTimestamp(command.expectedArrivalAt)
  const expiresAt = optionalTimestamp(command.expiresAt)
  if (expectedArrivalAt === null || expiresAt === null) return false
  if (expectedArrivalAt !== undefined && expectedArrivalAt < startedAt) return false
  if (expiresAt !== undefined && expiresAt < startedAt) return false
  return expectedArrivalAt === undefined || expiresAt === undefined || expiresAt >= expectedArrivalAt
}

function compareCommands(left: MovementCommand, right: MovementCommand): number {
  return right.priority - left.priority
    || right.stateVersion - left.stateVersion
    || Date.parse(left.startedAt) - Date.parse(right.startedAt)
    || compareCodeUnits(left.commandId, right.commandId)
}

function copyCommand(command: MovementCommand): MovementCommand {
  return { ...command }
}

function nonBlank(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function optionalTimestamp(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined
  if (!nonBlank(value)) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
