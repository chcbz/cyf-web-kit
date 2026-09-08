import { expect } from 'chai'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

describe('E13 offline synthetic mobility validator', () => {
  it('accepts blocked production diagnostics but rejects missing reasons or relabeled probes', () => {
    const result = spawnSync('python3', ['-c', `
from offline_pixel_renderer.validate import synthetic_probe_navigation_diagnostic
base = {'probeMobility': 'synthetic-visual-only', 'navValidation': {'reachability': {
  'source': 'production-graph-pathfinder', 'colliderWidth': 42, 'status': 'blocked', 'reason': 'collision'
}}}
assert synthetic_probe_navigation_diagnostic(base)
missing_reason = {'probeMobility': base['probeMobility'], 'navValidation': {'reachability': dict(base['navValidation']['reachability'], reason='')}}
assert not synthetic_probe_navigation_diagnostic(missing_reason)
relabelled = dict(base, probeMobility='production-reachable')
assert not synthetic_probe_navigation_diagnostic(relabelled)
print('PASS: synthetic blocked diagnostic contract')
`], { encoding: 'utf8', env: { ...process.env, PYTHONPATH: resolve('scripts/juyiting/e13') } })
    expect(result.status, result.stderr).to.equal(0)
    expect(result.stdout).to.include('PASS: synthetic blocked diagnostic contract')
  })
})
