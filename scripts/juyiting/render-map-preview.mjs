import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { validateMapRuntime } from '../../src/game/map/mapValidation.ts'
import { renderMapPreview } from '../../src/game/map/tmxPreviewRenderer.ts'
import { parseMovementTmx } from '../../src/game/map/tmxMovementParser.ts'

const tmxPath = fileURLToPath(new URL('../../public/juyiting/hall.tmx', import.meta.url))
const outputDirectory = fileURLToPath(new URL('../../docs/assets/juyiting/map-preview/', import.meta.url))

try {
  const runtime = parseMovementTmx(readFileSync(tmxPath, 'utf8'))
  const validation = validateMapRuntime(runtime)
  if (!validation.valid) {
    const details = validation.errors.map(error => `${error.code}: ${error.technicalMessage ?? error.userMessage}`).join('\n')
    throw new Error(`Juyiting map validation failed:\n${details}`)
  }

  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(new URL('hall-clean.svg', new URL('../../docs/assets/juyiting/map-preview/', import.meta.url)), renderMapPreview(runtime, { debug: false }), 'utf8')
  writeFileSync(new URL('hall-debug.svg', new URL('../../docs/assets/juyiting/map-preview/', import.meta.url)), renderMapPreview(runtime, { debug: true }), 'utf8')
  console.log('Juyiting map previews rendered')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
