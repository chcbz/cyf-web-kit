const reauthenticationByStore = new Map()

export function initiateReauthentication (apiStore) {
  if (!reauthenticationByStore.has(apiStore)) {
    const task = Promise.resolve().then(() => apiStore.beginAuthorization())
    reauthenticationByStore.set(apiStore, task)
  }
  return reauthenticationByStore.get(apiStore)
}

export function cancelReauthentication (apiStore) {
  reauthenticationByStore.delete(apiStore)
}
