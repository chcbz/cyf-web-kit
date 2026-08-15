/**
 * melonJS resource loading for Juyiting.
 *
 * TMX is the single source of truth for map image layers, tilesets, and
 * collection-of-images props. Keep static JS resources limited to boot assets
 * that are required before the TMX can be parsed.
 */

// Bind the runtime URL to the exact TMX bytes accepted by the V2 activation
// envelope. This prevents a browser-cached legacy hall.tmx from being paired
// with newer JavaScript validation rules during a rolling/static deployment.
export const HALL_MAP_VERSION = '7b304c11fd4a121d92f5fb1430f8073d4d590b3d42eb9b9a18e0e0c9bd22ff53'

export const HALL_MAP_RESOURCE = {
  name: 'juyiting-hall',
  type: 'tmx',
  src: `/juyiting/hall.tmx?v=${HALL_MAP_VERSION}`
}

export const HALL_BOOT_RESOURCES = [HALL_MAP_RESOURCE]

export const personaSpriteResourceName = personaCode => `persona-sprite-${personaCode}`

export const buildPersonaSpriteResource = definition => ({
  name: personaSpriteResourceName(definition.personaCode),
  type: 'image',
  src: definition.src
})

const addImageResource = (resources, seen, name, src) => {
  if (!name || !src) return
  const existingSrc = seen.get(name)
  if (existingSrc === src) {
    // Same resource name + same src: idempotent dedup.
    return
  }
  if (existingSrc !== undefined) {
    // melonJS registers images by name (basename-without-extension) in
    // loader.imgList, and getImage() looks up by basename, so two different
    // sources under the same name would silently overwrite each other at
    // runtime. Fail closed instead of hiding the collision.
    throw new Error(
      `Juyiting resource name collision: "${name}" maps to both "${existingSrc}" and "${src}". ` +
      'melonJS keys images by name (basename without extension), so the same name with ' +
      'different srcs would silently overwrite one of them.'
    )
  }
  seen.set(name, src)
  resources.push({ name, type: 'image', src })
}

export const buildHallMapResources = (mapData) => {
  const resources = []
  const seen = new Map()

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
    // melonJS getImage() normalizes lookups to basename-without-extension.
    // Register atlas images under that same key; using the full assetRef here
    // downloads successfully but leaves the image unreachable at runtime.
    const resourceName = assetRef.split('/').pop()?.replace(/\.[^.]+$/, '') || assetRef
    addImageResource(resources, seen, resourceName, '/juyiting/' + assetRef.replace(/^\/+/, ''))
  }

  return resources
}
