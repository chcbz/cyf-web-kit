import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  compareExactNames,
  exactDirectoryEntries,
  inspectPngFiles,
  sha256File,
} from './evidence-files.mjs'

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const hashOrNull = path => existsSync(path) ? sha256File(path) : null

export function validateReviewedEvidenceBindings ({ repo, evidenceDir, reviewedEvidenceDir }) {
  const results = []
  const check = (name, ok, detail = '') => results.push({ check: name, ok: Boolean(ok), detail: String(detail) })
  const visualPath = join(reviewedEvidenceDir, 'visual-review-v6.json')
  if (!existsSync(visualPath)) {
    check('GPT V6 review file exists', false, visualPath)
    return results
  }

  const visual = readJson(visualPath)
  const bindings = visual.bindings || {}
  const mappingDir = join(reviewedEvidenceDir, 'mask-structure-mapping')
  const mappingPath = join(mappingDir, 'mask-structure-mapping.json')
  const mappingSvgPath = join(mappingDir, 'mask-structure-mapping.svg')
  const planPath = join(evidenceDir, 'shot-plan.json')
  const indexPath = join(evidenceDir, 'index.json')
  const tmxPath = join(repo, 'public/juyiting/hall.tmx')
  const sheetsDir = join(reviewedEvidenceDir, 'contact-sheets')
  const boundSheets = bindings.contactSheets && typeof bindings.contactSheets === 'object' && !Array.isArray(bindings.contactSheets)
    ? bindings.contactSheets
    : {}
  const expectedNames = Object.keys(boundSheets).sort()
  const diskComparison = compareExactNames(exactDirectoryEntries(sheetsDir), expectedNames)

  check('GPT V6 full visual audit passes all 15 sheets and 37 mask cards',
    visual.pass === true && visual.verdict === 'PASS' && visual.highestSeverity === 'NONE' &&
    visual.contactSheetsReviewed === 15 && visual.shotsReviewed === 270 && visual.mappingCardsReviewed === 37 &&
    visual.v5Findings?.length === 5 && visual.v5Findings.every(finding => finding.verdict === 'PASS') &&
    visual.additionalFindings?.length === 0)
  check('GPT V6 binds the actual current TMX, shot-plan and matrix index hashes',
    bindings.tmxSha256 === hashOrNull(tmxPath) &&
    bindings.shotPlanSha256 === hashOrNull(planPath) &&
    bindings.indexSha256 === hashOrNull(indexPath),
    `tmx=${bindings.tmxSha256}/${hashOrNull(tmxPath)} plan=${bindings.shotPlanSha256}/${hashOrNull(planPath)} index=${bindings.indexSha256}/${hashOrNull(indexPath)}`)
  check('GPT V6 binds the actual 37-mask mapping JSON and SVG hashes',
    bindings.maskMappingSha256 === hashOrNull(mappingPath) &&
    bindings.maskMappingSvgSha256 === hashOrNull(mappingSvgPath),
    `json=${bindings.maskMappingSha256}/${hashOrNull(mappingPath)} svg=${bindings.maskMappingSvgSha256}/${hashOrNull(mappingSvgPath)}`)
  check('GPT V6 contact-sheet binding declares exactly 15 unique files',
    expectedNames.length === 15 && new Set(expectedNames).size === 15,
    `got ${expectedNames.length}`)
  check('reviewed contact-sheets directory exactly matches the V6-bound file set', diskComparison.ok,
    `missing=${diskComparison.missing.join(',')} extras=${diskComparison.extras.join(',')}`)

  const pngFailures = inspectPngFiles(sheetsDir, expectedNames, { width: 755, height: 398 })
  check('all 15 V6-bound contact sheets have PNG signature and 755x398 dimensions', pngFailures.length === 0, pngFailures.join('; '))
  const hashFailures = expectedNames.filter(name => existsSync(join(sheetsDir, name)) && hashOrNull(join(sheetsDir, name)) !== boundSheets[name])
  check('all 15 reviewed contact-sheet bytes match their V6 SHA-256 bindings', hashFailures.length === 0, hashFailures.join(', '))

  const sheetResults = Array.isArray(visual.sheetResults) ? visual.sheetResults : []
  const resultNames = sheetResults.map(result => result?.sheet).sort()
  const resultComparison = compareExactNames(resultNames, expectedNames)
  check('V6 sheetResults is the exact bound 15-sheet set with PASS verdicts',
    resultComparison.ok && new Set(resultNames).size === 15 && sheetResults.every(result => result?.verdict === 'PASS'),
    `missing=${resultComparison.missing.join(',')} extras=${resultComparison.extras.join(',')}`)
  check('V6 machinesGateSha256AtReview is retained as a non-circular historical SHA-256 binding',
    /^[0-9a-f]{64}$/.test(bindings.machinesGateSha256AtReview || ''), String(bindings.machinesGateSha256AtReview))
  return results
}
