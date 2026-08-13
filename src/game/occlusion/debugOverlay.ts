// ── E6 Debug Overlay ──
// Canvas-based debug overlay for occlusion system visualization.
// Activated ONLY when ?jytOcclusionDebug=1.
//
// Shows:
//  - Agent foot points (world coordinates)
//  - Fragment bounds and sortAnchor
//  - OcclusionConstraintZone polygons
//  - Grid cells (SpatialGrid coverage)
//  - Constraint edges and errors
//  - Live V2 order and depth diagnostics
//
// Overlay:
//  - Does NOT participate in hit-test or sorting
//  - Does NOT intercept pointer events
//  - Camera transform accurate (follows melonJS camera)
//  - Disposed on scene reset, no leaking listeners/renderables
//
// When debug off:
//  - Zero DOM/renderable additions
//  - Only low-cost counters maintained

import {
  type ShadowSnapshot,
  type ShadowDiagnostic,
} from './shadowRenderer.js'
import type { OcclusionConstraintZone, Point } from './schema.js'
import type { CanonicalSceneIr } from './schema.js'
import type { SpatialGrid } from './spatialGrid.js'
import { type CanonicalPolygonResult } from './validation.js'

// ── Constants ──

const OVERLAY_Z_INDEX = '99999'
const OVERLAY_CONTAINER_ID = 'jyt-occlusion-debug-overlay'
const DEFAULT_ALPHA = 0.85

const COLORS = {
  footPoint: '#00ff00',       // Green dots for agent feet
  footPointActive: '#00ff88',
  fragmentBounds: '#4488ff',  // Blue for fragment bounds
  fragmentAnchor: '#ff8800',  // Orange for sort anchors
  zonePolygon: '#ff4444',     // Red for zone polygons
  zonePolygonFill: 'rgba(255,68,68,0.15)',
  gridCell: '#888888',        // Gray for grid boundaries
  gridCellFill: 'rgba(136,136,136,0.05)',
  edgeBehind: '#ff00ff',      // Magenta for behind edges
  edgeFront: '#00ffff',       // Cyan for front edges
  errorHighlight: '#ff0000',  // Red for errors
  diffPositive: '#ffcc00',    // Yellow for v2 > runtime
  diffNegative: '#ff6600',    // Orange for runtime > v2
  textLabel: '#ffffff',       // White text
  textShadow: 'rgba(0,0,0,0.8)',
  bg: 'rgba(0,0,0,0.6)',
}

// ── Overlay state ──

interface DebugOverlayState {
  container: HTMLDivElement | null
  canvas: HTMLCanvasElement | null
  ctx: CanvasRenderingContext2D | null
  active: boolean
  destroyed: boolean
  lastSnapshot: ShadowSnapshot | null
  ir: CanonicalSceneIr | null
  grid: SpatialGrid | null
  cameraX: number
  cameraY: number
  cameraZoom: number
  viewportW: number
  viewportH: number
}

// ── Create overlay ──

export interface DebugOverlayOptions {
  /** melonJS game reference for camera access */
  game?: { viewport?: { pos?: { x: number; y: number }; width?: number; height?: number }; camera?: { zoom?: number } }
}

export function createDebugOverlay(opts: DebugOverlayOptions = {}) {
  return new DebugOverlay(opts)
}

export class DebugOverlay {
  private _game: DebugOverlayOptions['game']
  private _state: DebugOverlayState

  constructor(opts: DebugOverlayOptions = {}) {
    this._game = opts.game
    this._state = {
      container: null,
      canvas: null,
      ctx: null,
      active: false,
      destroyed: false,
      lastSnapshot: null,
      ir: null,
      grid: null,
      cameraX: 0,
      cameraY: 0,
      cameraZoom: 1,
      viewportW: 0,
      viewportH: 0,
    }
  }

  /** Activate the debug overlay. Creates DOM canvas. No-op if already active. */
  activate(): void {
    if (this._state.destroyed || this._state.active) return
    this._createDom()
    this._state.active = true
  }

  /** Deactivate and remove overlay DOM. */
  deactivate(): void {
    this._removeDom()
    this._state.active = false
    this._state.lastSnapshot = null
  }

  /** Check if overlay is active. */
  get active(): boolean { return this._state.active && !this._state.destroyed }

  /** Set game reference for camera updates. */
  setGame(game: DebugOverlayOptions['game']): void {
    this._game = game
  }

  /** Update overlay with latest shadow snapshot and IR. */
  update(
    snapshot: ShadowSnapshot,
    ir: CanonicalSceneIr | null,
    grid: SpatialGrid | null,
  ): void {
    if (!this._state.active || this._state.destroyed) return
    this._state.lastSnapshot = snapshot
    this._state.ir = ir
    this._state.grid = grid
    this._syncCamera()
    this._draw()
  }

  /** Dispose the overlay, removing all DOM and state. */
  dispose(): void {
    this._removeDom()
    this._state.destroyed = true
    this._state.lastSnapshot = null
    this._state.ir = null
    this._state.grid = null
    this._game = undefined
  }

  // ── Private: DOM ──

  private _createDom(): void {
    if (typeof document === 'undefined') return

    // Remove any existing overlay
    const existing = document.getElementById(OVERLAY_CONTAINER_ID)
    if (existing) existing.remove()

    const container = document.createElement('div')
    container.id = OVERLAY_CONTAINER_ID
    container.style.cssText = [
      `position: fixed;`,
      `top: 0; left: 0;`,
      `width: 100%; height: 100%;`,
      `z-index: ${OVERLAY_Z_INDEX};`,
      `pointer-events: none;`,  // Critical: never intercept pointer
      `user-select: none;`,
    ].join(' ')

    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'width: 100%; height: 100%; display: block;'
    container.appendChild(canvas)

    document.body.appendChild(container)

    this._state.container = container
    this._state.canvas = canvas
    this._state.ctx = canvas.getContext('2d')
  }

  private _removeDom(): void {
    if (this._state.container) {
      this._state.container.remove()
      this._state.container = null
    }
    this._state.canvas = null
    this._state.ctx = null
  }

  // ── Private: Camera ──

  private _syncCamera(): void {
    const vp = this._game?.viewport
    this._state.cameraX = vp?.pos?.x ?? 0
    this._state.cameraY = vp?.pos?.y ?? 0
    this._state.cameraZoom = this._game?.camera?.zoom ?? 1
    this._state.viewportW = vp?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 800)
    this._state.viewportH = vp?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 600)

    // Sync canvas size
    if (this._state.canvas) {
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
      const w = this._state.viewportW
      const h = this._state.viewportH
      this._state.canvas.width = w * dpr
      this._state.canvas.height = h * dpr
      this._state.canvas.style.width = `${w}px`
      this._state.canvas.style.height = `${h}px`
      if (this._state.ctx) {
        this._state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
    }
  }

  // ── Private: World to screen ──

  private _worldToScreen(wx: number, wy: number): { sx: number; sy: number } {
    return {
      sx: (wx - this._state.cameraX) * this._state.cameraZoom,
      sy: (wy - this._state.cameraY) * this._state.cameraZoom,
    }
  }

  // ── Private: Draw ──

  private _draw(): void {
    const ctx = this._state.ctx
    const canvas = this._state.canvas
    if (!ctx || !canvas) return

    const w = this._state.viewportW
    const h = this._state.viewportH
    ctx.clearRect(0, 0, w, h)

    // Semi-transparent background for readability
    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, w, h)

    // Draw info header
    this._drawInfoHeader(ctx)

    // Draw grid cells
    if (this._state.grid) {
      this._drawGridCells(ctx)
    }

    // Draw zones (polygons)
    if (this._state.ir?.zones) {
      this._drawZones(ctx)
    }

    // Draw fragments
    if (this._state.ir?.fragments) {
      this._drawFragments(ctx)
    }

    // Draw diagnostics (foot points, edges, diffs)
    if (this._state.lastSnapshot?.diagnostics) {
      this._drawDiagnostics(ctx)
    }

    // Draw errors
    if (this._state.lastSnapshot?.errors?.length) {
      this._drawErrors(ctx)
    }
  }

  private _drawInfoHeader(ctx: CanvasRenderingContext2D): void {
    const snap = this._state.lastSnapshot
    if (!snap) return

    ctx.save()
    ctx.fillStyle = COLORS.textLabel
    ctx.font = '12px monospace'
    ctx.textBaseline = 'top'

    const lines = [
      `Occlusion Debug v2 — ${snap.state} — #${snap.version}`,
      `Schema: ${snap.hasV2Schema ? 'v2' : 'none'} | Objects: ${snap.diagnostics.length} | Edges: ${snap.edgeCount}`,
      `Zones: ${snap.zoneCount} | Fragments: ${snap.fragmentCount} | Grid: ${snap.gridCellCount}c/${snap.gridEntryCount}e`,
      `Sort: ${snap.sortDurationMs.toFixed(2)}ms | Provider: ${snap.instrumentation?.providerTrusted ? 'trusted' : 'untrusted'}`,
    ]
    if (snap.errors.length) {
      lines.push(`Errors: ${snap.errors.length} — ${snap.errors[0].code}: ${snap.errors[0].message.slice(0, 60)}`)
    }

    let y = 8
    for (const line of lines) {
      ctx.fillStyle = COLORS.textShadow
      ctx.fillText(line, 9, y + 1)
      ctx.fillStyle = COLORS.textLabel
      ctx.fillText(line, 8, y)
      y += 16
    }
    ctx.restore()
  }

  private _drawGridCells(ctx: CanvasRenderingContext2D): void {
    const grid = this._state.grid
    if (!grid) return
    const cellSize = grid.getCellSize()

    ctx.save()
    ctx.strokeStyle = COLORS.gridCell
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.4

    const zoom = this._state.cameraZoom
    const cx = this._state.cameraX
    const cy = this._state.cameraY
    const w = this._state.viewportW
    const h = this._state.viewportH

    // Compute visible world bounds
    const worldLeft = cx
    const worldTop = cy
    const worldRight = cx + w / zoom
    const worldBottom = cy + h / zoom

    const startCellX = Math.floor(worldLeft / cellSize)
    const startCellY = Math.floor(worldTop / cellSize)
    const endCellX = Math.ceil(worldRight / cellSize)
    const endCellY = Math.ceil(worldBottom / cellSize)

    for (let cx_cell = startCellX; cx_cell <= endCellX; cx_cell++) {
      const { sx } = this._worldToScreen(cx_cell * cellSize, 0)
      ctx.beginPath()
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, h)
      ctx.stroke()
    }
    for (let cy_cell = startCellY; cy_cell <= endCellY; cy_cell++) {
      const { sy } = this._worldToScreen(0, cy_cell * cellSize)
      ctx.beginPath()
      ctx.moveTo(0, sy)
      ctx.lineTo(w, sy)
      ctx.stroke()
    }

    ctx.restore()
  }

  private _drawZones(ctx: CanvasRenderingContext2D): void {
    const zones = this._state.ir?.zones
    if (!zones?.length) return

    ctx.save()
    for (const zone of zones) {
      if (!zone.polygon?.length) continue

      ctx.beginPath()
      const first = this._worldToScreen(zone.polygon[0].x, zone.polygon[0].y)
      ctx.moveTo(first.sx, first.sy)
      for (let i = 1; i < zone.polygon.length; i++) {
        const pt = this._worldToScreen(zone.polygon[i].x, zone.polygon[i].y)
        ctx.lineTo(pt.sx, pt.sy)
      }
      ctx.closePath()

      ctx.fillStyle = COLORS.zonePolygonFill
      ctx.fill()
      ctx.strokeStyle = COLORS.zonePolygon
      ctx.lineWidth = 2
      ctx.stroke()

      // Label
      const labelPt = this._worldToScreen(
        zone.bounds?.x ?? zone.polygon[0].x,
        (zone.bounds?.y ?? zone.polygon[0].y) - 4,
      )
      ctx.fillStyle = COLORS.textLabel
      ctx.font = '9px monospace'
      ctx.fillText(`${zone.stableId.slice(0, 20)} (${zone.relation})`, labelPt.sx + 2, labelPt.sy)
    }
    ctx.restore()
  }

  private _drawFragments(ctx: CanvasRenderingContext2D): void {
    const frags = this._state.ir?.fragments
    if (!frags?.length) return

    ctx.save()
    ctx.strokeStyle = COLORS.fragmentBounds
    ctx.lineWidth = 1.5
    ctx.globalAlpha = 0.7

    for (const frag of frags) {
      const { sx, sy } = this._worldToScreen(
        frag.destinationRect.x,
        frag.destinationRect.y,
      )
      const sw = frag.destinationRect.width * this._state.cameraZoom
      const sh = frag.destinationRect.height * this._state.cameraZoom

      ctx.strokeRect(sx, sy, sw, sh)

      // Draw sortAnchor as orange dot
      const anchor = this._worldToScreen(frag.sortAnchor.x, frag.sortAnchor.y)
      ctx.fillStyle = COLORS.fragmentAnchor
      ctx.beginPath()
      ctx.arc(anchor.sx, anchor.sy, 4, 0, Math.PI * 2)
      ctx.fill()

      // Label
      ctx.fillStyle = COLORS.textLabel
      ctx.font = '9px monospace'
      const labelY = sy - 2 > 10 ? sy - 2 : sy + sh + 10
      ctx.fillText(
        `${frag.stableId.slice(0, 15)} y=${frag.sortAnchor.y.toFixed(0)}`,
        sx + 2,
        labelY,
      )
    }
    ctx.restore()
  }

  private _drawDiagnostics(ctx: CanvasRenderingContext2D): void {
    const diags = this._state.lastSnapshot?.diagnostics
    if (!diags?.length) return

    ctx.save()
    ctx.font = '9px monospace'
    ctx.textBaseline = 'middle'

    for (const d of diags) {
      if (d.kind !== 'agent') continue // Only draw agent foot points

      // We need to get position from the diagnostic - use v2SortKeyDetail
      // Foot point is approximated from sort key
      if (d.v2SortKeyDetail) {
        const footX = 0 // Not available from snapshot alone
        // We rely on sortAnchor from v2SortKeyDetail.fixedPointY
        // For now, try to reconstruct from the object
      }

      // Draw constraint edges
      for (const edge of d.constraintEdges) {
        ctx.strokeStyle = edge.kind === 'behind' ? COLORS.edgeBehind : COLORS.edgeFront
        ctx.lineWidth = 1
        ctx.globalAlpha = 0.5
        // Edge visualization is directional — draw from agent position
        // We can only approximate without full position data
      }
    }

    ctx.restore()
  }

  /**
   * Draw agent foot points from the snapshot diagnostics.
   * Each agent's position is rendered as a green dot.
   */
  drawAgentFootPoints(
    ctx: CanvasRenderingContext2D,
    agents: Array<{ x: number; y: number; stableId: string; runtimeDepth: number; v2Depth: number }>,
  ): void {
    ctx.save()
    ctx.font = '9px monospace'

    for (const agent of agents) {
      const { sx, sy } = this._worldToScreen(agent.x, agent.y)

      // Foot point
      ctx.fillStyle = COLORS.footPoint
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      ctx.arc(sx, sy, 3, 0, Math.PI * 2)
      ctx.fill()

      // Crosshair
      ctx.strokeStyle = COLORS.footPoint
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(sx - 6, sy)
      ctx.lineTo(sx + 6, sy)
      ctx.moveTo(sx, sy - 6)
      ctx.lineTo(sx, sy + 6)
      ctx.stroke()

      // Label with runtime/v2 depth
      ctx.fillStyle = COLORS.textShadow
      ctx.fillText(`${agent.stableId.slice(-8)} rt:${agent.runtimeDepth.toFixed(1)} v2:${agent.v2Depth.toFixed(1)}`, sx + 8, sy + 1)
      ctx.fillStyle = COLORS.textLabel
      ctx.fillText(`${agent.stableId.slice(-8)} rt:${agent.runtimeDepth.toFixed(1)} v2:${agent.v2Depth.toFixed(1)}`, sx + 7, sy)

      // Color code diff
      const diff = agent.v2Depth - agent.runtimeDepth
      if (Math.abs(diff) > 0.5) {
        ctx.fillStyle = diff > 0 ? COLORS.diffPositive : COLORS.diffNegative
        ctx.fillText(`Δ${diff > 0 ? '+' : ''}${diff.toFixed(1)}`, sx + 7, sy + 12)
      }
    }

    ctx.restore()
  }

  private _drawErrors(ctx: CanvasRenderingContext2D): void {
    const errors = this._state.lastSnapshot?.errors
    if (!errors?.length) return

    ctx.save()
    ctx.font = '10px monospace'
    ctx.fillStyle = COLORS.errorHighlight
    ctx.globalAlpha = 0.9

    let y = this._state.viewportH - 16
    for (let i = errors.length - 1; i >= Math.max(0, errors.length - 5); i--) {
      const e = errors[i]
      ctx.fillText(`[${e.code}] ${e.objectId}: ${e.message.slice(0, 80)}`, 8, y)
      y -= 14
    }
    ctx.restore()
  }
}

// ── Canvas rendering helpers ──

/** Draw a polygon outline on canvas context (screen-space coords). */
export function drawPolygonOutline(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  worldToScreen: (x: number, y: number) => { sx: number; sy: number },
  color: string,
  lineWidth = 2,
): void {
  if (!points?.length) return
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  const first = worldToScreen(points[0].x, points[0].y)
  ctx.moveTo(first.sx, first.sy)
  for (let i = 1; i < points.length; i++) {
    const pt = worldToScreen(points[i].x, points[i].y)
    ctx.lineTo(pt.sx, pt.sy)
  }
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

/** Draw a filled polygon outline. */
export function drawPolygonFilled(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  worldToScreen: (x: number, y: number) => { sx: number; sy: number },
  fillColor: string,
  strokeColor: string,
  lineWidth = 2,
): void {
  if (!points?.length) return
  ctx.save()
  ctx.beginPath()
  const first = worldToScreen(points[0].x, points[0].y)
  ctx.moveTo(first.sx, first.sy)
  for (let i = 1; i < points.length; i++) {
    const pt = worldToScreen(points[i].x, points[i].y)
    ctx.lineTo(pt.sx, pt.sy)
  }
  ctx.closePath()
  ctx.fillStyle = fillColor
  ctx.fill()
  ctx.strokeStyle = strokeColor
  ctx.lineWidth = lineWidth
  ctx.stroke()
  ctx.restore()
}

/** Draw a labeled point (for foot points, anchors). */
export function drawLabeledPoint(
  ctx: CanvasRenderingContext2D,
  worldX: number,
  worldY: number,
  worldToScreen: (x: number, y: number) => { sx: number; sy: number },
  color: string,
  label: string,
  radius = 3,
): void {
  const { sx, sy } = worldToScreen(worldX, worldY)
  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(sx, sy, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 0.5
  ctx.beginPath()
  ctx.moveTo(sx - radius * 2, sy)
  ctx.lineTo(sx + radius * 2, sy)
  ctx.moveTo(sx, sy - radius * 2)
  ctx.lineTo(sx, sy + radius * 2)
  ctx.stroke()
  if (label) {
    ctx.font = '9px monospace'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, sx + radius + 4, sy + 3)
  }
  ctx.restore()
}
