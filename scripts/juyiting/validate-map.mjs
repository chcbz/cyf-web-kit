import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { validateMapRuntime } from '../../src/game/map/mapValidation.ts'
import { createMapSnapshot, serializeMapSnapshot } from '../../src/game/map/tmxSnapshot.ts'
import { parseMovementTmx } from '../../src/game/map/tmxMovementParser.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmxPath = fileURLToPath(new URL('../../public/juyiting/hall.tmx', import.meta.url))
const snapshotPath = fileURLToPath(new URL('../../tests/fixtures/juyiting/hall-map.snapshot.json', import.meta.url))

try {
  const update = parseArguments(process.argv.slice(2))
  const runtime = parseMovementTmx(readFileSync(tmxPath, 'utf8'))
  const validation = validateMapRuntime(runtime)
  if (!validation.valid) {
    const details = validation.errors.map(error => `${error.code}: ${error.technicalMessage ?? error.userMessage}`).join('\n')
    throw new Error(`Juyiting map validation failed:\n${details}`)
  }

  const actual = serializeMapSnapshot(createMapSnapshot(runtime))
  if (update) {
    writeFileSync(snapshotPath, actual, 'utf8')
  } else {
    let expected
    try {
      expected = readFileSync(snapshotPath, 'utf8')
    } catch {
      throw new Error(`Juyiting map snapshot is missing. Run npm run validate:juyiting-map -- --update from ${root}.`)
    }
    if (actual !== expected) {
      throw new Error('Juyiting map snapshot mismatch. Review the TMX change, then run npm run validate:juyiting-map -- --update.')
    }
  }

  console.log('Juyiting map valid')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

function parseArguments(args) {
  if (args.length === 0) return false
  if (args.length === 1 && args[0] === '--update') return true
  throw new Error(`Unknown arguments: ${args.join(' ')}`)
}
