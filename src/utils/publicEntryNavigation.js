// Carry only the native portrait host marker, never arbitrary URL credentials or return targets.
// Public entry pages run in the portrait WebView; landscape has its own native page.
export const publicEntryTarget = (path, sourceQuery = {}, extraQuery = {}) => {
  const query = { ...extraQuery }
  if (sourceQuery.nativeOrientation === 'portrait') {
    query.nativeOrientation = 'portrait'
    if (sourceQuery.entry === 'direct' || sourceQuery.entry === 'fallback') {
      query.entry = sourceQuery.entry
    }
  }
  return { path, query }
}
