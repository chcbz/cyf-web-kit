# Frontend CI profiles (2026-10-09)

`npm test` / `test:run` select the `release` profile. Flow runs locked Node20
Mocha regressions and Vite as before, but does not install an unrelated browser/
RPM toolchain or run the offline E14 benchmark for ordinary application changes.
It still removes only restored legacy runtime directories on this job's isolated
worker, rejects missing fresh HTML/JSON reports, and exports `ci-profile.json`.
The release dependency install remains locked; artifact integrity and versioned
deployment/health checks are unchanged.

`test:assets` / `CYF_TEST_PROFILE=assets` select the 16 authoring/evidence files;
`test:all` / `CYF_TEST_PROFILE=all` include both profiles. Assets/all in Flow use
the pinned runtime and unchanged E14 procedure below. An asset/generator/renderer/
E13/E14/fixture change requires all-profile Flow validation at its fixed SHA; a
release-profile PASS alone does not validate those changes. No new pipeline or
automatic deployment is introduced.

## Asset/all test bootstrap

`scripts/ci-test.mjs` forwards Mocha arguments without a shell. Local release
runs use `.mocharc.json`; assets/all select their named config.
Preparation runs only for `CI=1/true/yes`, a nonempty `PIPELINE_ID`, or explicit
`CYF_CI_BOOTSTRAP=1`. The supported CI worker is Alinux3 Linux x64 with root.

CI installs signed distribution dependencies, SHA-verifies the pinned Node
20.20.2 / Chrome 133.0.6943.141 / WebP 1.2 RPM downloads, and extracts into a
fresh directory under the worker temporary directory (outside the Flow cache).
Only pinned archives and signed DNF data stay in `.cache/cyf-test-runtime`.
Restored legacy `run-XXXXXX` directories are removed only on this job's isolated
worker; links and unrelated cache names are not followed or removed. Archives are
rehashed on reuse. Chrome has a same-SHA mirror for download availability;
integrity failure always stops. RPM extraction uses system rpm2cpio/cpio
(rpmfile 2.2.1 requires a newer Python than Alinux3's default). The extracted
WebP library also has an exact SHA and decoder ABI/version check.

System dependency installation alone has a 20-minute first-run network budget.
Before contacting DNF/YUM, the bootstrap performs a read-only `/usr/bin/rpm --quiet
--query` for every package in the fixed allowlist. If every package is installed,
DNF/YUM is not invoked; if any are absent, only those fixed allowlisted names are
installed. An indeterminate RPM query fails closed before installation. DNF/YUM
keeps distribution signature verification (`gpgcheck=1`) and the existing
repositories, disables weak dependencies (`install_weak_deps=False`), and uses
`~/.cache/cyf-test-runtime/dnf` (root Flow: `/root/.cache/cyf-test-runtime/dnf`)
created before installation, within Flow's existing cache scope. Cached packages
still go through the signed package manager; this is not unchecked extraction.
The `rpm` and `cpio` packages provide extraction tools, verified with `command -v`;
`rpm-build` is unnecessary. All other explicit dependencies are retained, and
Chrome must pass `ldd` (no missing libraries) and the exact version check before
any benchmark. No E14 sampling, performance threshold or test timeout is changed.

The pinned Node is first on PATH and executes E14 and Mocha. Both CHROME_PATH
and CHROMIUM_HEADLESS point to an exec wrapper with --no-sandbox so E8 uses
the original Chrome and E14 can hash the real executable through /proc.
The wrapper is actually installed at `/usr/local/bin/chromium-headless-smoke`,
the E9B historical launcher path; its exec target is the fresh verified binary.
This avoids embedding a random cache-run path in deterministic atlas provenance.
Shallow origin history is fetched before historical tests.

Each assets/all CI test job first runs the existing restricted E14 benchmark with its
unchanged 10s warmup / 60s sample and p95 <= 2ms / p99 <= 4ms gates. A previous
report is backed up by copy-then-unlink; only the fresh report is eligible.
The full report is printed as `CYF_E14_REPORT_BASE64=...` immediately after
generation, including failed runs. Any preparation or E14 failure stops
before Mocha. Successful reports must also bind the prepared Chrome version,
executable SHA and wrapper SHA.

All-profile Mocha retains the original full suite; CI adds the dot
console reporter while preserving mochawesome HTML and JSON. The existing
`reportFilename=mochawesome.json` is normalized by the installed generator to
`mochawesome-report/mochawesome.html` and `mochawesome-report/mochawesome.json`.
The launcher logs those paths after Mocha and rejects a successful test exit
without both artifacts. No deployment configuration is changed; profile is explicit in artifact reports.

Focused verification (no downloads, benchmark or full suite):

```sh
node --import tsx node_modules/mocha/bin/mocha.js --no-config \
  --require tests/setup.js --reporter spec --exit tests/ci-test-bootstrap.test.js
```

## Cache scope fix (2026-10-09)

Run185/186 spent 77/76 seconds archiving a >2GB cache which Flow then declined
to upload. Extracted historical `run-XXXXXX` runtimes must not accumulate in the
cache. This source fix preserves archive rehashing, fresh extraction, pinned
browser identity and full tests. Local bootstrap tests are diagnostic only;
cache size/speed and the <=5 minute release target still require exact-source
Flow evidence. Timing evidence is maintained by the root task
`FRONTEND-RELEASE-5M-20261009`, not inferred from this change.
