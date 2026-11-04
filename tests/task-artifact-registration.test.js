import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { artifactRegistrationRequest, confirmedArtifactRegistration } from '../src/composables/juyiting/taskArtifactRegistration.js'
const fixture = JSON.parse(readFileSync(new URL('./fixtures/task-artifact-registration.json', import.meta.url)))
describe('fixed task artifact registration shared HTTP contract', () => {
  it('matches the Java HTTP request and deterministic key fixture without file bytes', async () => {
    const { taskId, artifactId, artifactVersion, contentSha256, filename } = fixture.request.data
    const request = await artifactRegistrationRequest({ taskId, item: { artifactId, artifactVersion, contentHash: contentSha256 }, filename })
    expect(request.data).to.deep.equal(fixture.request.data)
    expect(request.key).to.equal(fixture.idempotencyKey)
    expect(confirmedArtifactRegistration(fixture.response.data, request)).to.equal(true)
    for (const change of [{ operation: { state: 'PROCESSING' } }, { version: { ...fixture.response.data.version, sha256: 'a'.repeat(64) } }, { file: { ...fixture.response.data.file, originKind: 'USER_UPLOAD' } }]) {
      expect(confirmedArtifactRegistration({ ...fixture.response.data, ...change }, request)).to.equal(false)
    }
  })
})
