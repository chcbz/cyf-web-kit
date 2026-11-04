/** Immutable fixed-source request; retries use the same key across tabs and reloads. */
export async function artifactRegistrationRequest ({ taskId, item, filename }, cryptoApi = globalThis.crypto) {
  const artifactVersion = String(item.artifactVersion)
  const source = `${taskId}\n${item.artifactId}\n${artifactVersion}`
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(source))
  const key = 'task-artifact-' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return Object.freeze({ key, data: Object.freeze({ taskId, artifactId: item.artifactId, artifactVersion, contentSha256: item.contentHash, filename }) })
}
export function confirmedArtifactRegistration (result, request) {
  return result?.operation?.state === 'COMMITTED' && result.file?.originKind === 'AGENT_DELIVERY' &&
    result.file?.fileId === result.version?.fileId && result.operation.fileId === result.file.fileId &&
    result.version?.sha256 === request.data.contentSha256 && result.operation.fileVersion === result.version.version
}
