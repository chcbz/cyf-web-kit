/**
 * Logging helper based on consola.
 * Debug and trace output can be controlled by the consola runtime level.
 */
import { consola } from 'consola'

const logger = consola.withTag('App')

export const log = {
  debug: (...args) => logger.debug(...args),
  info: (...args) => logger.info(...args),
  warn: (...args) => logger.warn(...args),
  error: (...args) => logger.error(...args),
  success: (...args) => logger.success(...args),

  withTag: (tag) => consola.withTag(tag),

  withScope: (scope) => consola.withScope(scope)
}

export default logger
