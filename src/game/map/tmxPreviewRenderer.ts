import type { MapPoint, MapPolygon, MapRuntimeData } from './movementSchema.js'
import { createMapSnapshot } from './tmxSnapshot.js'

export interface MapPreviewOptions {
  debug: boolean
  art: readonly MapPreviewArtDescriptor[]
}

export interface MapPreviewArtDescriptor {
  stableId: string
  href: string
  x: number
  y: number
  width: number
  height: number
  opacity: number
}

export function renderMapPreview(runtime: MapRuntimeData, options: MapPreviewOptions): string {
  if (options.art.length === 0) throw new Error('At least one caller-derived preview art descriptor is required.')
  const map = createMapSnapshot(runtime)
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${map.width}" height="${map.height}" viewBox="0 0 ${map.width} ${map.height}" role="img" aria-labelledby="map-title map-description">`,
    '  <title id="map-title">Juyiting map preview</title>',
    `  <desc id="map-description">${escapeXml(`${map.sceneId} · graph ${map.navGraphVersion} · sprites ${map.spriteManifestVersion}`)}</desc>`,
    '  <defs>',
    '    <filter id="label-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#08110d" flood-opacity="0.9"/></filter>',
    ...(options.debug ? [
      '    <marker id="nav-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#57d7ff"/></marker>',
      '    <marker id="nav-arrow-reverse" markerWidth="10" markerHeight="10" refX="1" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M9,0 L9,6 L0,3 z" fill="#57d7ff"/></marker>',
    ] : []),
    '    <style>',
    '      .business-region{fill:#f4c95d;fill-opacity:.13;stroke:#f7dc91;stroke-width:2;vector-effect:non-scaling-stroke}',
    '      .business-label{font:700 22px system-ui,sans-serif;fill:#fff7d6;paint-order:stroke;stroke:#2a1b0d;stroke-width:5;stroke-linejoin:round;text-anchor:middle;filter:url(#label-shadow)}',
    ...(options.debug ? [
      '      .obstacle{fill:#ff4567;fill-opacity:.28;stroke:#ff6f87;stroke-width:2;vector-effect:non-scaling-stroke}',
      '      .nav-edge{fill:none;stroke:#57d7ff;stroke-width:4;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}',
      '      .nav-node{fill:#061c29;stroke:#87e7ff;stroke-width:3;vector-effect:non-scaling-stroke}',
      '      .slot{stroke:#101713;stroke-width:2;vector-effect:non-scaling-stroke}.slot-parking{fill:#ffd166}.slot-queue{fill:#ef6fff}.slot-home{fill:#69ef9d}',
      '      .debug-label{font:600 14px ui-monospace,monospace;fill:#fff;paint-order:stroke;stroke:#10151c;stroke-width:4;stroke-linejoin:round}',
      '      .debug-small{font-size:12px}',
    ] : []),
    '    </style>',
    '  </defs>',
    `  <rect width="${map.width}" height="${map.height}" fill="#17251d"/>`,
    ...options.art.map(art => `  <image class="map-art" data-art-id="${escapeXml(art.stableId)}" href="${escapeXml(art.href)}" x="${number(art.x)}" y="${number(art.y)}" width="${number(art.width)}" height="${number(art.height)}" opacity="${number(art.opacity)}" preserveAspectRatio="none"/>`),
    '  <g class="business-regions">',
    ...map.regions.flatMap(region => {
      const center = polygonCenter(region.polygon)
      return [
        `    <polygon class="business-region" points="${pointsAttribute(region.polygon.points)}"><title>${escapeXml(`${region.label} (${region.stableId})`)}</title></polygon>`,
        `    <text class="business-label" x="${number(center.x)}" y="${number(center.y)}">${escapeXml(region.label)}</text>`,
      ]
    }),
    '  </g>',
    ...(options.debug ? debugLayers(map) : []),
    '</svg>',
    '',
  ]
  return lines.join('\n')
}

function debugLayers(map: ReturnType<typeof createMapSnapshot>): string[] {
  return [
    '  <g class="debug-obstacles">',
    ...map.obstacles.map((obstacle, index) => `    <polygon class="obstacle" points="${pointsAttribute(obstacle.points)}"><title>obstacle-${String(index + 1).padStart(3, '0')}</title></polygon>`),
    '  </g>',
    '  <g class="debug-edges">',
    ...map.edges.flatMap(edge => {
      const center = lineCenter(edge.points)
      const markerStart = edge.bidirectional ? ' marker-start="url(#nav-arrow-reverse)"' : ''
      return [
        `    <polyline class="nav-edge" data-stable-id="${escapeXml(edge.stableId)}" points="${pointsAttribute(edge.points)}"${markerStart} marker-end="url(#nav-arrow)"><title>${escapeXml(`${edge.stableId}: ${edge.from} → ${edge.to}${edge.bidirectional ? ' ↔' : ''}`)}</title></polyline>`,
        `    <text class="debug-label debug-small" x="${number(center.x + 8)}" y="${number(center.y - 8)}">${escapeXml(edge.stableId)}</text>`,
      ]
    }),
    '  </g>',
    '  <g class="debug-nodes">',
    ...map.nodes.flatMap(node => [
      `    <circle class="nav-node" data-stable-id="${escapeXml(node.stableId)}" cx="${number(node.point.x)}" cy="${number(node.point.y)}" r="9"><title>${escapeXml(`${node.stableId} · ${node.kind} · ${node.channelWidth}px`)}</title></circle>`,
      `    <text class="debug-label" x="${number(node.point.x + 13)}" y="${number(node.point.y - 13)}">${escapeXml(`${node.stableId} · ${node.kind} · ${node.channelWidth}px`)}</text>`,
    ]),
    '  </g>',
    '  <g class="debug-slots">',
    ...map.slots.flatMap(slot => [
      `    <rect class="slot slot-${escapeXml(String(slot.kind))}" data-stable-id="${escapeXml(slot.stableId)}" x="${number(slot.point.x - 7)}" y="${number(slot.point.y - 7)}" width="14" height="14" rx="3"><title>${escapeXml(`${slot.stableId} · ${slot.kind} · ${slot.slotId}`)}</title></rect>`,
      `    <text class="debug-label debug-small" x="${number(slot.point.x + 11)}" y="${number(slot.point.y + 5)}">${escapeXml(`${slot.stableId} · ${slot.kind}`)}</text>`,
    ]),
    '  </g>',
  ]
}

function polygonCenter(polygon: MapPolygon): MapPoint {
  if (polygon.points.length === 0) return { x: 0, y: 0 }
  const sum = polygon.points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 })
  return { x: sum.x / polygon.points.length, y: sum.y / polygon.points.length }
}

function lineCenter(points: MapPoint[]): MapPoint {
  if (points.length === 0) return { x: 0, y: 0 }
  return points[Math.floor((points.length - 1) / 2)]
}

function pointsAttribute(points: MapPoint[]): string {
  return points.map(point => `${number(point.x)},${number(point.y)}`).join(' ')
}

function number(value: number): string {
  const rounded = Number(value.toFixed(3))
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
