# Juyiting E14 fixed performance gate

## Formal Chromium gate

```bash
npm run benchmark:juyiting-occlusion-e14
npm run test:juyiting-occlusion-e14
```

The runner builds a production-only Vite entry, serves it over localhost, and runs
Chromium at 1664×928 with 108 agents, 50 fragments, and 37 zones. It performs a
10 second warmup followed by a 60 second sample. The measured interval is exactly
`SpatialGrid` agent update plus unified world ordering.

Formal pass thresholds:

- p95 <= 2.0 ms
- p99 <= 4.0 ms
- zero full-grid scans
- sparse membership checks
- no sustained heap growth / GC thrash

The Chromium report is written to:

`tests/fixtures/juyiting/occlusion-e14/benchmark-report.json`

## Diagnostic Node/V8 profile

```bash
npm run profile:juyiting-occlusion-e14:node
```

This runs the same production bundle and fixed 10s+60s workload in Node/V8 with
jsdom. It is useful for optimization and regression diagnosis but is explicitly
**not eligible** to pass E14. Its report always has `pass: false` and is written to:

`tests/fixtures/juyiting/occlusion-e14/node-profile-report.json`

## Restricted-host note

The current managed workspace sandbox blocks localhost listen/connect and the
`shutdown(2)` call used during Chromium startup. On that host the formal runner
fails before page execution. This is an environment blocker, not a benchmark
pass or fail; run the formal command on the normal deployment/test host or CI.


## Restricted managed-host Chromium gate

When localhost sockets and Chromium's `shutdown(2)` call are blocked by the
managed Seccomp profile, run:

```bash
npm run benchmark:juyiting-occlusion-e14:restricted
npm run test:juyiting-occlusion-e14
```

This path still runs the same production bundle in installed Chromium at
1664×928 with the fixed 10s warmup, 60s sample, fixture, and thresholds. It uses
`file://` plus CDP pipe instead of HTTP plus TCP CDP, runs Chromium in
single-process/no-zygote mode, and compiles a narrow `LD_PRELOAD` shim that only
turns a Seccomp-generated `shutdown(2) == EPERM` into success. Reports identify
this transport and remain ineligible unless the user agent and execution engine
prove a real Chromium run.
