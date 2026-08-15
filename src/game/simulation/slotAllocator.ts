import type { MapRuntimeData, Slot } from '../map/movementSchema.js'
import type { MovementCommand } from './movementCommandQueue.js'

export type MovementSlotOwner = {
  agentId: string
  commandId: string
}

export type SlotAllocator = {
  homeFor(personaCode: string): Slot | null
  /** Returns currently eligible slots without changing ownership. */
  available(regionId: string, command: MovementCommand): Slot[]
  /** Atomically claims this exact eligible slot, releasing a prior slot only after success. */
  reserveSlot(slotId: string, command: MovementCommand): Slot | null
  /** Legacy deterministic first-eligible reservation. Prefer available + reserveSlot for scored selection. */
  reserve(regionId: string, command: MovementCommand): Slot | null
  release(slotId: string, agentId: string): boolean
  occupant(slotId: string): MovementSlotOwner | null
}

export function createSlotAllocator(source: MapRuntimeData | readonly Slot[]): SlotAllocator {
  const sourceSlots: readonly Slot[] = 'slots' in source ? source.slots : source
  const slots = sourceSlots
    .map(copySlot)
    .sort(compareSlots)
  const slotsById = new Map(slots.map(slot => [slot.slotId, slot]))
  const ownersBySlot = new Map<string, MovementSlotOwner>()
  const slotIdByAgent = new Map<string, string>()
  const eligibleSlots = (regionId: string, command: MovementCommand): Slot[] => slots.filter(slot => (
    slot.regionId === regionId
    && (command.type === 'RETURN_HOME'
      ? slot.kind === 'home' && slot.personaCode === command.personaCode
      : slot.kind === 'parking')
  ))

  return {
    homeFor(personaCode) {
      const home = slots.find(slot => slot.kind === 'home' && slot.personaCode === personaCode)
      return home ? copySlot(home) : null
    },

    available(regionId, command) {
      if (!nonBlank(regionId) || !validOwnerCommand(command)) return []
      return eligibleSlots(regionId, command).filter(slot => {
        const owner = ownersBySlot.get(slot.slotId)
        return owner === undefined || owner.agentId === command.agentId
      }).map(copySlot)
    },

    reserveSlot(slotId, command) {
      if (!nonBlank(slotId) || !validOwnerCommand(command)) return null
      const selected = slotsById.get(slotId)
      if (!selected || !eligibleSlots(selected.regionId, command).some(slot => slot.slotId === slotId)) return null
      const owner = ownersBySlot.get(slotId)
      if (owner && owner.agentId !== command.agentId) return null

      const previousSlotId = slotIdByAgent.get(command.agentId)
      // Claim the selected slot before releasing the old one: there is never a state
      // where the agent loses its current reservation because the target was invalid.
      ownersBySlot.set(slotId, { agentId: command.agentId, commandId: command.commandId })
      slotIdByAgent.set(command.agentId, slotId)
      if (previousSlotId && previousSlotId !== slotId) ownersBySlot.delete(previousSlotId)
      return copySlot(selected)
    },

    reserve(regionId, command) {
      const selected = this.available(regionId, command)[0]
      return selected ? this.reserveSlot(selected.slotId, command) : null
    },

    release(slotId, agentId) {
      const owner = ownersBySlot.get(slotId)
      if (!owner || owner.agentId !== agentId) return false
      ownersBySlot.delete(slotId)
      if (slotIdByAgent.get(agentId) === slotId) slotIdByAgent.delete(agentId)
      return true
    },

    occupant(slotId) {
      if (!slotsById.has(slotId)) return null
      const owner = ownersBySlot.get(slotId)
      return owner ? { ...owner } : null
    },
  }
}

function validOwnerCommand(command: MovementCommand | null | undefined): command is MovementCommand {
  return Boolean(command && nonBlank(command.commandId) && nonBlank(command.agentId)
    && nonBlank(command.personaCode))
}

function compareSlots(left: Slot, right: Slot): number {
  return compareCodeUnits(left.stableId, right.stableId)
    || compareCodeUnits(left.slotId, right.slotId)
}

function copySlot(slot: Slot): Slot {
  return { ...slot, point: { ...slot.point } }
}

function nonBlank(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
