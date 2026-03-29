/**
 * 日志工具 - 基于 consola 封装
 * 在生产环境自动抑制 debug 和 trace 日志
 */
import { consola } from 'consola'

// 创建命名日志实例
const logger = consola.withTag('App')

// 导出便捷方法
export const log = {
  debug: (...args) => logger.debug(...args),
  info: (...args) => logger.info(...args),
  warn: (...args) => logger.warn(...args),
  error: (...args) => logger.error(...args),
  success: (...args) => logger.success(...args),
  
  // 创建带标签的子日志
  withTag: (tag) => consola.withTag(tag),
  
  // 创建带作用域的子日志
  withScope: (scope) => consola.withScope(scope)
}

export default logger
