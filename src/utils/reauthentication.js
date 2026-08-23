const reauthenticationByStore = new WeakMap()

export function initiateReauthentication (apiStore) {
  if (!reauthenticationByStore.has(apiStore)) {
    const task = Promise.resolve().then(() => apiStore.beginAuthorization())
    reauthenticationByStore.set(apiStore, task)
  }
  return reauthenticationByStore.get(apiStore)
}
