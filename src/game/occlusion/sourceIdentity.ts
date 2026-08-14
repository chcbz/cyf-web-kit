/**
 * Shared source-entity identity boundary for Juyi Hall runtime inputs.
 * JavaScript string length is measured in UTF-16 code units, preserving
 * Unicode/emoji while bounding synchronous sorting and async hashing work.
 */
export const SOURCE_ENTITY_ID_MAX_LENGTH = 256

export function isValidSourceEntityId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= SOURCE_ENTITY_ID_MAX_LENGTH
    && value.trim().length > 0
}
