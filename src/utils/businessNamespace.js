import { createHydratedIdentityScope } from './identityScope.js'

// Browser recovery is scoped to the application and hydrated account only.
// The connected backend owns the business region and enforces data access.
export function browserBusinessNamespace (apiStore, globalStore) {
  if (apiStore?.hasCurrentAccount && !apiStore.hasCurrentAccount()) return ''
  return createHydratedIdentityScope(globalStore?.user, apiStore?.oauthClientId)
}
