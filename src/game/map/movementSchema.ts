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
  label?: string
  capacity?: number
  protected?: boolean
  riskLevel?: string
}

export interface NavNode {
  stableId: string
  point: MapPoint
  kind: 'normal' | 'junction' | 'doorway' | 'narrow'
  channelWidth?: number
}

export interface NavEdge {
  stableId: string
  from: string
  to: string
  bidirectional: boolean
  costMultiplier: number
  points: MapPoint[]
}

export type SlotType = 'parking' | 'queue' | 'home'

export interface Slot {
  stableId: string
  slotType: SlotType
  regionId: string
  point: MapPoint
  priority?: number
  capacity?: number
  facing?: string
  radiusX?: number
  radiusY?: number
  personaCode?: string
}

export interface MapRuntimeData {
  sceneId?: string
  movementSchemaVersion?: string
  navGraphVersion?: string
  spriteManifestVersion?: string
  width: number
  height: number
  navArea: MapPolygon[]
  navObstacles: MapPolygon[]
  regions: Region[]
  navNodes: NavNode[]
  navEdges: NavEdge[]
  slots: Slot[]
}
