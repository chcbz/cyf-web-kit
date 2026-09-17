const PROFILE_ROUTE = 'UserProfile'
const JUYI_HALL_ROUTE = 'JuyiHall'
const ECONOMY_PREVIEW_ROUTE = 'EconomyReadOnlyPreview'
const COMMAND_OBSERVABILITY_ROUTE = 'CommandObservability'

const PREVIEW_FAILURE_REASON = Object.freeze({
  DISABLED: 'disabled',
  UNAVAILABLE: 'unavailable'
})

const profileTarget = () => ({ name: PROFILE_ROUTE })
const juyiHallTarget = () => ({ name: JUYI_HALL_ROUTE })
const economyPreviewTarget = () => ({ name: ECONOMY_PREVIEW_ROUTE })
const commandObservabilityTarget = () => ({ name: COMMAND_OBSERVABILITY_ROUTE })

/** Only fixed, internal reasons may cross the route guard boundary. */
const previewFailureReason = reason => reason === 'PREVIEW_DISABLED' || reason === PREVIEW_FAILURE_REASON.DISABLED
  ? PREVIEW_FAILURE_REASON.DISABLED
  : PREVIEW_FAILURE_REASON.UNAVAILABLE

const previewFailureMessage = reason => previewFailureReason(reason) === PREVIEW_FAILURE_REASON.DISABLED
  ? '经济只读预览当前未开放。不会扣款、下单、安装或启用托管。'
  : '经济只读预览暂时不可用。请稍后重试；不会扣款、下单、安装或启用托管。'

const profilePreviewFailureTarget = reason => ({
  ...profileTarget(),
  query: { preview: previewFailureReason(reason) }
})

const previewFailureFromRoute = route => {
  const reason = route?.query?.preview
  return typeof reason === 'string' && Object.values(PREVIEW_FAILURE_REASON).includes(reason)
    ? reason
    : ''
}

const openEconomyPreview = router => router.push(economyPreviewTarget())
const openCommandObservability = router => router.push(commandObservabilityTarget())
const returnToProfile = router => router.replace(profileTarget())
const returnToJuyiHall = router => router.replace(juyiHallTarget())

export {
  COMMAND_OBSERVABILITY_ROUTE,
  ECONOMY_PREVIEW_ROUTE,
  JUYI_HALL_ROUTE,
  PREVIEW_FAILURE_REASON,
  PROFILE_ROUTE,
  commandObservabilityTarget,
  economyPreviewTarget,
  juyiHallTarget,
  openCommandObservability,
  openEconomyPreview,
  previewFailureFromRoute,
  previewFailureMessage,
  profilePreviewFailureTarget,
  profileTarget,
  returnToJuyiHall,
  returnToProfile
}
