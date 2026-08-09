#!/usr/bin/env node
/** Fail-closed validator for the E9A V2 semantic/RLE ownership contract. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ALPHA_THRESHOLD,
  CANONICAL_EXPECTED_SHA256,
  COMPONENT_CONNECTIVITY,
  REGION_DEFS,
  REGION_ORDER,
  SEMANTIC_OWNER_CATALOG,
  SPEC_PATH,
  STABLE_ID_RE,
  analyzeOwnership,
  compareRuns,
  componentGeometryKey,
  computeGenerationId,
  createAlphaMap,
  decodeCanonicalOwnership,
  runPixelCount,
  stableStringify,
} from './lib/fragment-ownership-v2.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')
const GENERIC_LABELS = new Set(['structure', 'detail', 'element'])

function sameRect(left, right) {
  return left && right && left.x === right.x && left.y === right.y &&
    left.width === right.width && left.height === right.height
}

function sortedUnique(values) {
  return [...new Set(values)].sort()
}

function validateRegionPartition(spec, errors) {
  const regions = spec.regionPartition?.regions ?? {}
  const names = Object.keys(regions).sort()
  if (JSON.stringify(names) !== JSON.stringify([...REGION_ORDER].sort())) {
    errors.push(`Region names mismatch: expected ${REGION_ORDER.join(', ')}, got ${names.join(', ')}`)
  }
  for (const region of REGION_ORDER) {
    const expected = REGION_DEFS[region]
    const actual = regions[region]
    if (!actual) continue
    if (JSON.stringify(actual.xRange) !== JSON.stringify([expected.xMin, expected.xMax]) ||
        JSON.stringify(actual.yRange) !== JSON.stringify([expected.yMin, expected.yMax])) {
      errors.push(`Region ${region} bounds mismatch or gap: expected x=[${expected.xMin},${expected.xMax}) y=[${expected.yMin},${expected.yMax})`)
    }
    if (actual.chunkId !== region) errors.push(`Region ${region} chunkId must equal region name`)
  }
  if (spec.regionPartition?.semantics !== 'atlas-home-region-only-not-a-pixel-clip-boundary') {
    errors.push('regionPartition.semantics must declare atlas-home-region-only-not-a-pixel-clip-boundary')
  }
}

function validateOutputConstraints(spec, errors) {
  const constraints = spec.outputConstraints ?? {}
  if (constraints.pixelOwnershipModel !== 'alpha-rle-v1') errors.push('outputConstraints.pixelOwnershipModel must be alpha-rle-v1')
  if (constraints.losslessOnly !== true) errors.push('outputConstraints.losslessOnly must be true')
  if (constraints.alphaRequired !== true) errors.push('outputConstraints.alphaRequired must be true')
  if (!Array.isArray(constraints.formats) || !constraints.formats.includes('lossless-webp') || !constraints.formats.includes('png')) {
    errors.push('outputConstraints.formats must include lossless-webp and png')
  }
  if (constraints.sourceRectOverlapPolicy !== 'allowed-because-runs-are-authoritative') {
    errors.push('sourceRect overlap policy must be allowed-because-runs-are-authoritative')
  }
  if (constraints.opaqueNeighborPolicy !== 'different owners must never meet across a 4-neighbor opaque edge') {
    errors.push('opaque neighbor policy is missing or changed')
  }
  if (!Array.isArray(constraints.opaqueCutEdgeExceptions) || constraints.opaqueCutEdgeExceptions.length !== 0) {
    errors.push('opaqueCutEdgeExceptions must be an explicit empty array; this E9A revision permits no seam exceptions')
  }
  if (constraints.fragmentCount !== spec.fragments?.length) errors.push('outputConstraints.fragmentCount does not match fragments')
  const actualCounts = Object.fromEntries(REGION_ORDER.map(region => [region, 0]))
  for (const fragment of spec.fragments ?? []) if (actualCounts[fragment.homeRegion] !== undefined) actualCounts[fragment.homeRegion]++
  if (JSON.stringify(actualCounts) !== JSON.stringify(constraints.regionFragmentCounts)) {
    errors.push(`regionFragmentCounts mismatch: expected ${JSON.stringify(actualCounts)}`)
  }
}

function validateDownstreamRequirements(spec, errors) {
  const zooms = spec.downstreamRequirements?.E9B?.zoomSeamEvidence?.requiredZooms
  if (JSON.stringify(zooms) !== JSON.stringify(['0.75', '1', '1.25', '1.5', '2'])) {
    errors.push('E9B zoom seam evidence must require 0.75/1/1.25/1.5/2')
  }
  if (spec.downstreamRequirements?.E10A?.expectedLegacyMaskCount !== 37) {
    errors.push('E10A mask mapping dependency must declare 37 legacy masks')
  }
}

function validate(spec, decoded, actualSourceHash) {
  const errors = []
  const warnings = []
  if (spec.$schema !== 'jyt.occlusion.fragment-ownership-spec.v2' || spec.schemaVersion !== 2) {
    errors.push('Spec must use jyt.occlusion.fragment-ownership-spec.v2 / schemaVersion 2')
  }
  if (spec.taskId !== 'E9A') errors.push('taskId must be E9A')
  if (actualSourceHash !== spec.sourceProvenance?.sha256) {
    errors.push(`Source SHA-256 mismatch: expected ${spec.sourceProvenance?.sha256}, got ${actualSourceHash}`)
  }
  if (spec.sourceProvenance?.sha256 !== CANONICAL_EXPECTED_SHA256) {
    errors.push(`Canonical SHA-256 must remain ${CANONICAL_EXPECTED_SHA256}`)
  }
  if (decoded.width !== spec.sourceProvenance?.width) errors.push(`Width mismatch: expected ${spec.sourceProvenance?.width}, got ${decoded.width}`)
  if (decoded.height !== spec.sourceProvenance?.height) errors.push(`Height mismatch: expected ${spec.sourceProvenance?.height}, got ${decoded.height}`)
  if (decoded.totalOpaquePixels !== spec.sourceProvenance?.totalOpaquePixels) {
    errors.push(`Opaque pixel count mismatch: expected ${spec.sourceProvenance?.totalOpaquePixels}, got ${decoded.totalOpaquePixels}`)
  }
  if (spec.sourceProvenance?.alphaThreshold !== ALPHA_THRESHOLD) errors.push(`alpha threshold must be ${ALPHA_THRESHOLD}`)
  if (spec.sourceProvenance?.canonicalComponentConnectivity !== COMPONENT_CONNECTIVITY) errors.push(`canonical component connectivity must be ${COMPONENT_CONNECTIVITY}`)
  if (spec.sourceProvenance?.canonicalComponentCount !== decoded.components.length) errors.push(`canonical component count mismatch: expected ${decoded.components.length}`)

  validateRegionPartition(spec, errors)
  validateOutputConstraints(spec, errors)
  validateDownstreamRequirements(spec, errors)

  const fragments = Array.isArray(spec.fragments) ? spec.fragments : []
  const ids = new Set()
  const expectedCatalog = new Map(SEMANTIC_OWNER_CATALOG.map(entry => [entry.stableId, entry]))
  const componentByGeometry = new Map(decoded.components.map(component => [componentGeometryKey(component), component]))
  const alpha = createAlphaMap(decoded)
  const componentIndexMap = new Int32Array(decoded.width * decoded.height)
  componentIndexMap.fill(-1)
  decoded.components.forEach((component, componentIndex) => {
    for (const [y, xStart, xEnd] of component.runs) {
      for (let x = xStart; x < xEnd; x++) componentIndexMap[y * decoded.width + x] = componentIndex
    }
  })

  for (let fragmentIndex = 0; fragmentIndex < fragments.length; fragmentIndex++) {
    const fragment = fragments[fragmentIndex]
    const prefix = `Fragment ${fragment.stableId ?? `#${fragmentIndex}`}`
    if (!STABLE_ID_RE.test(fragment.stableId ?? '')) errors.push(`${prefix} has invalid stableId format`)
    if (ids.has(fragment.stableId)) errors.push(`Duplicate stableId: ${fragment.stableId}`)
    ids.add(fragment.stableId)
    const catalog = expectedCatalog.get(fragment.stableId)
    if (!catalog) {
      errors.push(`${prefix} is absent from the reviewed semantic catalog`)
    } else {
      if (fragment.homeRegion !== catalog.homeRegion || fragment.region !== catalog.homeRegion || fragment.chunkId !== catalog.homeRegion) {
        errors.push(`${prefix} wrong region/homeRegion/chunk; expected ${catalog.homeRegion}`)
      }
      if (fragment.semanticType !== catalog.semanticType) errors.push(`${prefix} semanticType mismatch; expected ${catalog.semanticType}`)
      if (stableStringify(fragment.semanticOwnership?.componentGroupPolicy) !== stableStringify(catalog.componentGroupPolicy)) {
        errors.push(`${prefix} componentGroupPolicy differs from reviewed catalog`)
      }
    }
    if (GENERIC_LABELS.has(fragment.semanticType)) errors.push(`${prefix} uses forbidden generic semantic label ${fragment.semanticType}`)

    const rect = fragment.sourceRect
    if (!rect || !Number.isInteger(rect.x) || !Number.isInteger(rect.y) || !Number.isInteger(rect.width) || !Number.isInteger(rect.height) || rect.width <= 0 || rect.height <= 0) {
      errors.push(`${prefix} sourceRect must contain positive integer dimensions`)
    } else if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > decoded.width || rect.y + rect.height > decoded.height) {
      errors.push(`${prefix} sourceRect out of bounds: (${rect.x},${rect.y},${rect.width},${rect.height})`)
    }
    if (!sameRect(rect, fragment.destinationRect)) errors.push(`${prefix} destinationRect differs from sourceRect`)
    if (fragment.destinationMapping?.mode !== 'source-coordinate-identity' || fragment.destinationMapping?.sampling !== 'none' ||
        fragment.destinationMapping?.scaleNumerator !== 1 || fragment.destinationMapping?.scaleDenominator !== 1) {
      errors.push(`${prefix} destination mapping must be exact 1:1 with no sampling`)
    }
    if (fragment.pixelOwnershipRule?.model !== 'alpha-rle-v1' || fragment.pixelOwnershipRule?.threshold !== ALPHA_THRESHOLD) {
      errors.push(`${prefix} pixel ownership rule must be alpha-rle-v1 at threshold ${ALPHA_THRESHOLD}`)
    }
    if (fragment.outputEncoding?.losslessRequired !== true || fragment.outputEncoding?.alphaRequired !== true ||
        !fragment.outputEncoding?.allowed?.includes('lossless-webp') || !fragment.outputEncoding?.allowed?.includes('png')) {
      errors.push(`${prefix} output format must permit lossless-webp/png with required alpha/lossless encoding`)
    }

    const runs = fragment.ownershipRuns
    if (!Array.isArray(runs) || runs.length === 0) {
      errors.push(`${prefix} has no ownershipRuns`)
      continue
    }
    let previous = null
    const actualComponentIndexes = new Set()
    for (let runIndex = 0; runIndex < runs.length; runIndex++) {
      const run = runs[runIndex]
      if (!Array.isArray(run) || run.length !== 3 || !run.every(Number.isInteger)) {
        errors.push(`${prefix} RLE run ${runIndex} must be three integers`)
        continue
      }
      const [y, xStart, xEnd] = run
      if (previous && compareRuns(previous, run) >= 0) errors.push(`${prefix} ownershipRuns are unsorted or duplicated at run ${runIndex}`)
      if (previous && previous[0] === y && previous[2] >= xStart) errors.push(`${prefix} ownershipRuns overlap or are not maximally merged at run ${runIndex}`)
      previous = run
      if (y < 0 || y >= decoded.height || xStart < 0 || xEnd > decoded.width || xStart >= xEnd) {
        errors.push(`${prefix} RLE run out of bounds at index ${runIndex}: ${JSON.stringify(run)}`)
        continue
      }
      if (rect && (y < rect.y || y >= rect.y + rect.height || xStart < rect.x || xEnd > rect.x + rect.width)) {
        errors.push(`${prefix} RLE run lies outside sourceRect at index ${runIndex}`)
      }
      for (let x = xStart; x < xEnd; x++) {
        const pixelIndex = y * decoded.width + x
        if (!alpha[pixelIndex]) errors.push(`${prefix} RLE owns transparent pixel (${x},${y})`)
        const componentIndex = componentIndexMap[pixelIndex]
        if (componentIndex >= 0) actualComponentIndexes.add(componentIndex)
      }
    }
    if (fragment.ownedOpaquePixelCount !== runPixelCount(runs)) errors.push(`${prefix} ownedOpaquePixelCount mismatch`)

    const actualComponentIds = sortedUnique([...actualComponentIndexes].map(index => decoded.components[index].componentId))
    const declaredComponentIds = sortedUnique(fragment.semanticOwnership?.canonicalComponentIds ?? [])
    if (JSON.stringify(actualComponentIds) !== JSON.stringify(declaredComponentIds)) {
      errors.push(`${prefix} semantic component set mismatch: runs=${JSON.stringify(actualComponentIds)} declared=${JSON.stringify(declaredComponentIds)}`)
    }
    if (catalog) {
      const expectedComponentIds = catalog.componentKeys.map(key => componentByGeometry.get(key)?.componentId).filter(Boolean).sort()
      if (JSON.stringify(actualComponentIds) !== JSON.stringify(expectedComponentIds)) {
        errors.push(`${prefix} broad/disconnected semantic group differs from reviewed catalog: expected ${JSON.stringify(expectedComponentIds)}`)
      }
      const policy = fragment.semanticOwnership?.componentGroupPolicy
      const declaredComponents = fragment.semanticOwnership?.canonicalComponents
      if (!Array.isArray(declaredComponents)) {
        errors.push(`${prefix} canonicalComponents must record component identity/bounds/hash`)
      } else {
        const expectedComponents = catalog.componentKeys.map(key => componentByGeometry.get(key)).filter(Boolean).map(component => ({
          componentId: component.componentId,
          identitySha256: component.identitySha256,
          geometryKey: component.geometryKey,
          bounds: { ...component.bounds },
          opaquePixelCount: component.pixelCount,
        })).sort((left, right) => left.geometryKey.localeCompare(right.geometryKey))
        const sortedDeclaredComponents = [...declaredComponents].sort((left, right) => String(left?.geometryKey).localeCompare(String(right?.geometryKey)))
        if (stableStringify(sortedDeclaredComponents) !== stableStringify(expectedComponents)) {
          errors.push(`${prefix} canonical component identity/bounds/hash differs from decoded source`)
        }
      }
      if (policy?.mode === 'single-component' && actualComponentIds.length !== 1) {
        errors.push(`${prefix} single-component owner contains ${actualComponentIds.length} disconnected canonical components`)
      }
      if (actualComponentIds.length > 1 && policy?.mode !== 'approved-same-observable-object-parts') {
        errors.push(`${prefix} disconnected components require explicit approved-same-observable-object-parts componentGroupPolicy`)
      }
      if (policy?.mode === 'approved-same-observable-object-parts') {
        if (!policy.observableObject || !policy.approvalBasis || !Array.isArray(policy.approvedParts)) {
          errors.push(`${prefix} grouped owner requires observableObject, approvalBasis, and approvedParts`)
        } else {
          const approvedKeys = policy.approvedParts.map(part => part?.componentKey).sort()
          if (stableStringify(approvedKeys) !== stableStringify([...catalog.componentKeys].sort()) ||
              policy.approvedParts.some(part => !part?.role)) {
            errors.push(`${prefix} componentGroupPolicy approvedParts must exactly name every reviewed component and role`)
          }
        }
      }
    }
  }

  for (const stableId of expectedCatalog.keys()) if (!ids.has(stableId)) errors.push(`Missing reviewed semantic owner: ${stableId}`)
  const sortedIds = fragments.map(fragment => fragment.stableId)
  const canonicalOrder = [...sortedIds].sort((a, b) => Buffer.from(a ?? '').compare(Buffer.from(b ?? '')))
  if (JSON.stringify(sortedIds) !== JSON.stringify(canonicalOrder)) errors.push('fragments must be serialized in stableId ASCII order for reproducibility')

  const analysis = analyzeOwnership(spec, decoded)
  if (analysis.opaqueUnowned) errors.push(`${analysis.opaqueUnowned} opaque pixels have no RLE owner; sample=${JSON.stringify(analysis.unownedSamples)}`)
  if (analysis.overlapPixels) errors.push(`${analysis.overlapPixels} RLE overlap pixels; sample=${JSON.stringify(analysis.overlapSamples)}`)
  if (analysis.transparentOwned) errors.push(`${analysis.transparentOwned} transparent pixels are RLE-owned; sample=${JSON.stringify(analysis.transparentOwnedSamples)}`)
  if (analysis.opaqueCutEdgeCount) errors.push(`opaque cut edge count must be zero, got ${analysis.opaqueCutEdgeCount}; sample=${JSON.stringify(analysis.opaqueCutEdgeSamples)}`)

  // An 8-connected canonical component must be wholly owned by one semantic owner.
  const componentOwners = decoded.components.map(() => new Set())
  fragments.forEach((fragment, fragmentIndex) => {
    for (const [y, xStart, xEnd] of fragment.ownershipRuns ?? []) {
      if (!Number.isInteger(y) || y < 0 || y >= decoded.height) continue
      for (let x = Math.max(0, xStart); x < Math.min(decoded.width, xEnd); x++) {
        const componentIndex = componentIndexMap[y * decoded.width + x]
        if (componentIndex >= 0) componentOwners[componentIndex].add(fragmentIndex)
      }
    }
  })
  componentOwners.forEach((owners, index) => {
    if (owners.size !== 1) errors.push(`Canonical component ${decoded.components[index].componentId} is split or unowned across ${owners.size} owners`)
  })

  try {
    const expectedGenerationId = computeGenerationId(spec)
    if (spec.generationId !== expectedGenerationId || spec.generation?.generationId !== spec.generationId) {
      errors.push(`generationId mismatch: expected ${expectedGenerationId}, got ${spec.generationId}`)
    }
  } catch (error) {
    errors.push(`generationId computation failed: ${error.message}`)
  }

  return { errors: [...new Set(errors)], warnings, analysis }
}

function main() {
  const requested = process.argv[2] || SPEC_PATH
  const fullSpecPath = join(REPO_ROOT, requested)
  if (!existsSync(fullSpecPath)) {
    console.error(`ERROR: Spec not found: ${fullSpecPath}`)
    process.exit(2)
  }
  let spec
  try {
    spec = JSON.parse(readFileSync(fullSpecPath, 'utf8'))
  } catch (error) {
    console.error(`ERROR: Invalid spec JSON: ${error.message}`)
    process.exit(2)
  }
  const canonicalPath = join(REPO_ROOT, spec.sourceProvenance?.path ?? '')
  if (!existsSync(canonicalPath)) {
    console.error(`ERROR: Canonical source not found: ${canonicalPath}`)
    process.exit(1)
  }
  const canonicalBytes = readFileSync(canonicalPath)
  const actualSourceHash = createHash('sha256').update(canonicalBytes).digest('hex')
  let decoded
  try {
    decoded = decodeCanonicalOwnership(canonicalBytes)
  } catch (error) {
    console.error(`ERROR: Canonical decode failed: ${error.message}`)
    process.exit(1)
  }

  console.error(`Validating ${requested}`)
  console.error(`Fragments: ${spec.fragments?.length ?? 0}; canonical components: ${decoded.components.length}`)
  const { errors, warnings, analysis } = validate(spec, decoded, actualSourceHash)
  for (const warning of warnings) console.error(`WARNING: ${warning}`)
  for (const error of errors) console.error(`ERROR: ${error}`)
  if (errors.length) {
    console.error(`${errors.length} validation error(s)`)
    process.exit(1)
  }
  console.error(`All validations passed; opaque=${analysis.opaqueOwned}/${analysis.totalOpaquePixels}; opaqueCutEdgeCount=${analysis.opaqueCutEdgeCount}`)
}

main()
