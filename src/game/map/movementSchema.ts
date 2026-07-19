export interface MapPoint {
  x: number
  y: number
}

export interface MapPolygon {
  points: MapPoint[]
}

export interface Region {
  stableId: string
  regionId: string
  polygon: MapPolygon
  label: string
  capacity: number
  protected: boolean
  riskLevel: string
}

export interface NavNode {
  stableId: string
  point: MapPoint
  kind: 'normal' | 'junction' | 'doorway' | 'narrow'
  channelWidth: number
}

export interface NavEdge {
  stableId: string
  from: string
  to: string
  bidirectional: boolean
  costMultiplier: number
  points: MapPoint[]
}

export interface Slot {
  stableId: string
  slotId: string
  regionId: string
  point: MapPoint
  personaCode?: string
  kind: 'parking' | 'queue' | 'home'
}

export interface PatrolRoute {
  stableId: string
  routeId: string
  personaCode: string
  regionIds: string[]
  loop: boolean
  dwellMs: number
  priority: number
}

export interface MapRuntimeData {
  sceneId: string
  movementSchemaVersion: string
  navGraphVersion: string
  spriteManifestVersion: string
  width: number
  height: number
  regions: Region[]
  nodes: NavNode[]
  edges: NavEdge[]
  slots: Slot[]
  patrolRoutes: PatrolRoute[]
  obstacles: MapPolygon[]
}
