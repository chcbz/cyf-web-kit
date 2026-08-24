const reauthenticationByStore = new WeakMap()

export function initiateReauthentication (apiStore) {
  const existing = reauthenticationByStore.get(apiStore)
  if (existing) return existing.promise

  const entry = { cancelled: false, promise: null }
  entry.promise = Promise.resolve().then(() => {
    if (entry.cancelled) return false
    return apiStore.beginAuthorization()
  }).finally(() => {
    if (reauthenticationByStore.get(apiStore) === entry) reauthenticationByStore.delete(apiStore)
  })
  reauthenticationByStore.set(apiStore, entry)
  return entry.promise
}

export function cancelReauthentication (apiStore) {
  const entry = reauthenticationByStore.get(apiStore)
  if (entry) entry.cancelled = true
  reauthenticationByStore.delete(apiStore)
}
