import { expect } from 'chai'
import { spawnSyncCaptured } from '../scripts/juyiting/lib/spawn-capture.mjs'
import { resolve } from 'node:path'

describe('E13 explicit cross-platform decoder proofs', () => {
  it('checks all source RGBA proofs and rejects unapproved identities, inputs and decoded output drift', function () {
    this.timeout(30000)
    const result = spawnSyncCaptured('python3', ['-c', `
import copy, glob, os, tempfile
from offline_pixel_renderer import png_io
from offline_pixel_renderer.webp_profiles import REFERENCE_SHA
actual = png_io.webp_decoder_provenance()
assert png_io.compatible_recorded_decoder(actual)
historical = dict(png_io.EXPECTED_WEBP, crossHostPolicy='fail-closed historical identity')
assert png_io.compatible_recorded_decoder(historical)
historical['equivalentReferenceSha256'] = None
assert not png_io.compatible_recorded_decoder(historical)
native = dict(actual, sha256='979c17adab6dff218b8bae090e8ec9a1ca1af0116f6c7e0e107f670eacddaed4', decoderVersionHex='0x010500', decoderVersion='1.5.0')
native.pop('equivalentReferenceSha256', None)
assert not png_io.compatible_recorded_decoder(native)
native['equivalentReferenceSha256'] = REFERENCE_SHA
assert png_io.compatible_recorded_decoder(native)
for key, value in [('sha256', '0'*64), ('decoderVersionHex', '0x010999'), ('api', []), ('equivalentReferenceSha256', '0'*64)]:
    tampered = dict(actual, **{key:value})
    assert not png_io.compatible_recorded_decoder(tampered), key
files = sorted(glob.glob('public/juyiting/**/*.webp', recursive=True))
assert len(files) == 10
for path in files:
    png_io.decode_webp(path)
with tempfile.NamedTemporaryFile(suffix='.webp') as invalid:
    invalid.write(b'not an approved source'); invalid.flush()
    try: png_io.decode_webp(invalid.name)
    except RuntimeError as error: assert 'unreviewed WebP source' in str(error)
    else: raise AssertionError('accepted mutated source')
    png_io._WEBP_STATE = None
    os.environ['E13_WEBP_LIBRARY'] = invalid.name
    try: png_io.webp_decoder_provenance()
    except RuntimeError as error: assert 'no approved libwebp' in str(error)
    else: raise AssertionError('accepted unknown binary')
    del os.environ['E13_WEBP_LIBRARY']
proofs = dict(png_io.RGBA_PROOFS)
try:
    for key, (w,h,digest) in proofs.items(): png_io.RGBA_PROOFS[key] = (w,h,'0'*64)
    try: png_io.decode_webp(files[0])
    except RuntimeError as error: assert 'RGBA proof mismatch' in str(error)
    else: raise AssertionError('accepted changed decoded pixels')
finally:
    png_io.RGBA_PROOFS.update(proofs)
print('PASS: 10 source proofs; identity/source/output mutations rejected')
`], { encoding: 'utf8', timeout: 25000, env: { ...process.env, PYTHONPATH: resolve('scripts/juyiting/e13') } })
    expect(result.status, result.stderr || result.error?.message).to.equal(0)
    expect(result.stdout).to.include('PASS: 10 source proofs')
  })
})
