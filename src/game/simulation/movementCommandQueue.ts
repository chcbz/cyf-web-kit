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
  | { accepted: false; reason: 'duplicate-command-id' | 'stale-state-version' | 'invalid-command' }

export type MovementCommandQueue = {
  readonly size: number
  push(command: MovementCommand): MovementCommandPushResult
  peek(): MovementCommand | null
  shift(): MovementCommand | null
  snapshot(): MovementCommand[]
  clear(agentId?: string): number
}

export function createMovementCommandQueue(): MovementCommandQueue {
  const pending: MovementCommand[] = []
  const seenCommandIds = new Set<string>()
  const latestStateVersion = new Map<string, number>()

  return {
    get size() {
      return pending.length
    },

    push(source) {
      if (!validCommand(source)) return { accepted: false, reason: 'invalid-command' }
      if (seenCommandIds.has(source.commandId)) {
        return { accepted: false, reason: 'duplicate-command-id' }
      }
      const watermark = latestStateVersion.get(source.agentId)
      if (watermark !== undefined && source.stateVersion <= watermark) {
        return { accepted: false, reason: 'stale-state-version' }
      }

      const command = copyCommand(source)
      const replacedIndex = pending.findIndex(item => item.agentId === command.agentId)
      const replacedCommandId = replacedIndex >= 0 ? pending[replacedIndex]?.commandId : undefined
      if (replacedIndex >= 0) pending.splice(replacedIndex, 1)
      pending.push(command)
      pending.sort(compareCommands)
      seenCommandIds.add(command.commandId)
      latestStateVersion.set(command.agentId, command.stateVersion)
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

    clear(agentId) {
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
  return Number.isFinite(Date.parse(command.startedAt))
}

function compareCommands(left: MovementCommand, right: MovementCommand): number {
  return right.priority - left.priority
    || right.stateVersion - left.stateVersion
    || Date.parse(left.startedAt) - Date.parse(right.startedAt)
    || left.commandId.localeCompare(right.commandId)
}

function copyCommand(command: MovementCommand): MovementCommand {
  return { ...command }
}

function nonBlank(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0
}
