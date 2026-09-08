const finiteNumber = value => Number.isFinite(Number(value)) ? Number(value) : null

export const rectFromEdges = value => {
  const left = finiteNumber(value?.left ?? value?.x)
  const top = finiteNumber(value?.top ?? value?.y)
  const width = finiteNumber(value?.width)
  const height = finiteNumber(value?.height)
  if (left === null || top === null || width === null || height === null || width <= 0 || height <= 0) return null
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height
  }
}

export const viewportBoundsToClientRect = ({ bounds, canvasRect, viewport, virtualLandscape = false }) => {
  const source = rectFromEdges(bounds)
  const canvas = rectFromEdges(canvasRect)
  const viewportWidth = finiteNumber(viewport?.width)
  const viewportHeight = finiteNumber(viewport?.height)
  if (!source || !canvas || viewportWidth === null || viewportHeight === null || viewportWidth <= 0 || viewportHeight <= 0) return null

  if (virtualLandscape) {
    return rectFromEdges({
      left: canvas.left + ((viewportHeight - source.bottom) / viewportHeight) * canvas.width,
      top: canvas.top + (source.left / viewportWidth) * canvas.height,
      width: (source.height / viewportHeight) * canvas.width,
      height: (source.width / viewportWidth) * canvas.height
    })
  }

  return rectFromEdges({
    left: canvas.left + (source.left / viewportWidth) * canvas.width,
    top: canvas.top + (source.top / viewportHeight) * canvas.height,
    width: (source.width / viewportWidth) * canvas.width,
    height: (source.height / viewportHeight) * canvas.height
  })
}

export const paddedTargetRect = (rect, viewport, padding = 8, margin = 4) => {
  const source = rectFromEdges(rect)
  const viewportWidth = finiteNumber(viewport?.width)
  const viewportHeight = finiteNumber(viewport?.height)
  if (!source || viewportWidth === null || viewportHeight === null || viewportWidth <= margin * 2 || viewportHeight <= margin * 2) return null

  const left = Math.max(margin, source.left - padding)
  const top = Math.max(margin, source.top - padding)
  const right = Math.min(viewportWidth - margin, source.right + padding)
  const bottom = Math.min(viewportHeight - margin, source.bottom + padding)
  return rectFromEdges({ left, top, width: right - left, height: bottom - top })
}

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(value, maximum))

export const positionOnboardingDialog = ({ targetRect, dialogSize, viewport, margin = 12, gap = 20, arrowSize = 16 }) => {
  const target = rectFromEdges(targetRect)
  const viewportWidth = Math.max(0, finiteNumber(viewport?.width) ?? 0)
  const viewportHeight = Math.max(0, finiteNumber(viewport?.height) ?? 0)
  const width = Math.min(Math.max(0, finiteNumber(dialogSize?.width) ?? 0), Math.max(0, viewportWidth - margin * 2))
  const height = Math.min(Math.max(0, finiteNumber(dialogSize?.height) ?? 0), Math.max(0, viewportHeight - margin * 2))
  if (width <= 0 || height <= 0) return null

  if (!target) {
    return {
      placement: 'center',
      dialog: rectFromEdges({ left: (viewportWidth - width) / 2, top: (viewportHeight - height) / 2, width, height }),
      arrow: null
    }
  }

  const spaces = {
    below: viewportHeight - margin - target.bottom - gap,
    above: target.top - margin - gap,
    right: viewportWidth - margin - target.right - gap,
    left: target.left - margin - gap
  }
  const required = { below: height, above: height, right: width, left: width }
  const ordered = ['below', 'above', 'right', 'left']
  const fitting = ordered.filter(placement => spaces[placement] >= required[placement])
  const placement = (fitting.length ? fitting : ordered)
    .sort((first, second) => spaces[second] - spaces[first])[0]

  let left
  let top
  if (placement === 'below' || placement === 'above') {
    left = clamp(target.left + target.width / 2 - width / 2, margin, viewportWidth - margin - width)
    top = placement === 'below' ? target.bottom + gap : target.top - gap - height
  } else {
    left = placement === 'right' ? target.right + gap : target.left - gap - width
    top = clamp(target.top + target.height / 2 - height / 2, margin, viewportHeight - margin - height)
  }
  left = clamp(left, margin, viewportWidth - margin - width)
  top = clamp(top, margin, viewportHeight - margin - height)

  const arrowHalf = arrowSize / 2
  let arrowLeft
  let arrowTop
  if (placement === 'below' || placement === 'above') {
    arrowLeft = clamp(target.left + target.width / 2 - arrowHalf, left + 16, left + width - arrowSize - 16)
    arrowTop = placement === 'below' ? top - arrowHalf : top + height - arrowHalf
  } else {
    arrowLeft = placement === 'right' ? left - arrowHalf : left + width - arrowHalf
    arrowTop = clamp(target.top + target.height / 2 - arrowHalf, top + 16, top + height - arrowSize - 16)
  }

  return {
    placement,
    dialog: rectFromEdges({ left, top, width, height }),
    arrow: rectFromEdges({ left: arrowLeft, top: arrowTop, width: arrowSize, height: arrowSize })
  }
}
