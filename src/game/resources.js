/**
 * melonJS resource loading for Juyiting.
 *
 * TMX is the single source of truth for map image layers, tilesets, and
 * collection-of-images props. Keep static JS resources limited to boot assets
 * that are required before the TMX can be parsed.
 */

export const HALL_MAP_RESOURCE = { name: 'juyiting-hall', type: 'tmx', src: '/juyiting/hall.tmx' }

export const HALL_BOOT_RESOURCES = [HALL_MAP_RESOURCE]

export const personaSpriteResourceName = personaCode => `persona-sprite-${personaCode}`

export const buildPersonaSpriteResource = definition => ({
  name: personaSpriteResourceName(definition.personaCode),
  type: 'image',
  src: definition.src
})

const addImageResource = (resources, seen, name, src) => {
  if (!name || !src) return
  const key = `${name}\u0000${src}`
  if (seen.has(key)) return
  seen.add(key)
  resources.push({ name, type: 'image', src })
}

export const buildHallMapResources = (mapData) => {
  const resources = []
  const seen = new Set()

  ;(mapData?.tilesets || []).forEach(tileset => {
    addImageResource(
      resources,
      seen,
      tileset.tilesetResourceName || tileset.resourceName || tileset.name,
      tileset.imageSource || tileset.source
    )

    ;(tileset.tiles || []).forEach(tile => {
      if (!tile) return
      addImageResource(resources, seen, tile.resourceName, tile.source)
    })
  })

  Object.values(mapData?.imageLayers || {}).forEach(layer => {
    addImageResource(resources, seen, layer.resourceName || layer.id, layer.source)
  })

  // E12: V2 fragment occluder atlas images
  // Extract assetRef values from v2-fragments-occluders layer in mapData
  const fragLayers = (mapData?.layers || []).filter(
    l => l && l.type === 'objectgroup' && (l.name === 'v2-fragments-occluders' || l.name === 'v2-fragments')
  )
  const fragAssets = new Set()
  for (const layer of fragLayers) {
    for (const obj of (layer.objects || [])) {
      const assetRef = obj?.properties?.assetRef
      if (assetRef && typeof assetRef === 'string') fragAssets.add(assetRef)
    }
  }
  for (const assetRef of fragAssets) {
    // Resource name = assetRef path (melonJS uses name for getImage lookup)
    addImageResource(resources, seen, assetRef, '/juyiting/' + assetRef.replace(/^\/+/, ''))
  }

  return resources
}
