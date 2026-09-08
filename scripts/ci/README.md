# Repository test bootstrap

`npm test` and `npm run test:run` use `scripts/ci-test.mjs`. Local runs retain
the original Node + tsx + `.mocharc.json` command and forward every argument.
Preparation runs only for `CI=1/true/yes`, a nonempty `PIPELINE_ID`, or explicit
`CYF_CI_BOOTSTRAP=1`. The supported CI worker is Alinux3 Linux x64 with root.

CI installs signed distribution dependencies, SHA-verifies the pinned Node
20.20.2 / Chrome 133.0.6943.141 / WebP 1.2 RPM downloads, and extracts into a
fresh directory under the CI user's `.cache/cyf-test-runtime`. Archives are
rehashed on reuse. Chrome has a same-SHA mirror for download availability;
integrity failure always stops. RPM extraction uses system rpm2cpio/cpio
(rpmfile 2.2.1 requires a newer Python than Alinux3's default). The extracted
WebP library also has an exact SHA and decoder ABI/version check.

The pinned Node is first on PATH and executes E14 and Mocha. Both CHROME_PATH
and CHROMIUM_HEADLESS point to an exec wrapper with --no-sandbox so E8 uses
the original Chrome and E14 can hash the real executable through /proc.
Shallow origin history is fetched before historical tests.

Each CI test job first runs the existing restricted E14 benchmark with its
unchanged 10s warmup / 60s sample and p95 <= 2ms / p99 <= 4ms gates. A previous
report is backed up by copy-then-unlink; only the fresh report is eligible.
The full report is printed as `CYF_E14_REPORT_BASE64=...` immediately after
generation, including failed runs. Any preparation or E14 failure stops
before Mocha. Successful reports must also bind the prepared Chrome version,
executable SHA and wrapper SHA.

Mocha retains the original configuration and full suite; CI adds the dot
console reporter while preserving mochawesome HTML and JSON. The existing
`reportFilename=mochawesome.json` is normalized by the installed generator to
`mochawesome-report/mochawesome.html` and `mochawesome-report/mochawesome.json`.
The launcher logs those paths after Mocha and rejects a successful test exit
without both artifacts. No pipeline or deployment configuration is changed.

Focused verification (no downloads, benchmark or full suite):

```sh
node --import tsx node_modules/mocha/bin/mocha.js --no-config \
  --require tests/setup.js --reporter spec --exit tests/ci-test-bootstrap.test.js
```
