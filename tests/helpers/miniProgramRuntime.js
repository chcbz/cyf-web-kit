import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

// Model the native JS-only module loader, not Node's JSON require extension.
export const createMiniRuntimeLoader = directory => (relative, globals) => {
  const miniRoot = path.resolve(directory)
  const context = vm.createContext({ ...globals })
  const cache = new Map()
  const load = filename => {
    if (path.extname(filename) !== '.js') throw new Error('Mini-program require only loads JavaScript: ' + filename)
    if (cache.has(filename)) return cache.get(filename).exports
    const module = { exports: {} }; cache.set(filename, module)
    const require = specifier => {
      let target = path.resolve(path.dirname(filename), specifier)
      if (!target.startsWith(miniRoot + path.sep)) throw new Error('Outside mini runtime')
      if (!path.extname(target)) target += '.js'
      return load(target)
    }
    vm.runInContext('(function(require, module, exports) {' + readFileSync(filename, 'utf8') + '\n})', context, { filename })(require, module, module.exports)
    return module.exports
  }
  return load(path.join(miniRoot, relative))
}
