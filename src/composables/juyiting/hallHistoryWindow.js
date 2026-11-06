/** Geometry only. Page descriptors hold cursors/heights, never historical bodies. */
export const historyWindowSegments = (pages, { top = 0, height = 0, pinned = new Set() } = {}) => {
  if (!pages.length) return []
  const viewport = Math.max(1, height)
  const low = Math.max(0, top - viewport)
  const high = top + viewport * 2
  const segments = []
  let offset = 0
  for (const page of pages) {
    const size = Math.max(1, page.height || viewport)
    const visible = offset + size >= low && offset <= high
    if (visible || pinned.has(page.key)) segments.push({ key: page.key, page, height: size, top: offset })
    else {
      const previous = segments.at(-1)
      if (previous?.spacer) previous.height += size
      else segments.push({ key: `spacer:${page.key}`, spacer: true, height: size, top: offset })
    }
    offset += size
  }
  return segments
}

/** Keep an on-screen page at the same offset when another page changes height. */
export const historyWindowAnchor = (pages, top, fallbackHeight) => {
  let offset = 0
  for (const page of pages) {
    const height = Math.max(1, page.height || fallbackHeight || 1)
    if (offset + height > top) return { key: page.key, within: top - offset }
    offset += height
  }
  return null
}
export const historyWindowAnchorTop = (pages, anchor, fallbackHeight) => {
  if (!anchor) return null
  let offset = 0
  for (const page of pages) {
    if (page.key === anchor.key) return offset + anchor.within
    offset += Math.max(1, page.height || fallbackHeight || 1)
  }
  return null
}

/** Pure retention decision; explicit interaction pins are independent of distance. */
export const retainedHistoryPageKeys = (pages, view) => new Set(
  historyWindowSegments(pages, view).filter(segment => !segment.spacer).map(segment => segment.key)
)
