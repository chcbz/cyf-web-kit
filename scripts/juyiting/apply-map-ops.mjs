#!/usr/bin/env node

import { open, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { tsImport } from 'tsx/esm/api'

const [, , tmxArgument, operationsArgument] = process.argv
if (!tmxArgument || !operationsArgument || process.argv.length !== 4) {
  process.stderr.write('Usage: node scripts/juyiting/apply-map-ops.mjs <map.tmx> <operations.json>\n')
  process.exitCode = 2
} else {
  await main(resolve(tmxArgument), resolve(operationsArgument))
}

async function main(tmxPath, operationsPath) {
  if (tmxPath === operationsPath) throw new Error('TMX and operations paths must be different')
  const [sourceXml, operationJson, metadata] = await Promise.all([
    readFile(tmxPath, 'utf8'),
    readFile(operationsPath, 'utf8'),
    stat(tmxPath),
  ])
  const operations = JSON.parse(operationJson)
  if (!Array.isArray(operations)) throw new Error('Operation JSON must contain an array')
  const moduleUrl = new URL('../../src/game/map/tmxEditOps.ts', import.meta.url)
  const { applyTmxEditOps } = await tsImport(moduleUrl.href, import.meta.url)
  const result = applyTmxEditOps(sourceXml, operations)
  if (result === sourceXml) {
    process.stdout.write(`unchanged ${tmxPath}\n`)
    return
  }

  const temporaryPath = resolve(dirname(tmxPath), `.${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}.tmx.tmp`)
  let handle
  try {
    handle = await open(temporaryPath, 'wx', metadata.mode)
    await handle.writeFile(result, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporaryPath, tmxPath)
  } finally {
    if (handle) await handle.close().catch(() => undefined)
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
  process.stdout.write(`updated ${tmxPath}\n`)
}
