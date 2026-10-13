# Runtime self-host onboarding fixture

`handoff.json` is an offline output of `cyf_runtime_enrollment_prepare.mjs`, generated with the v1 wire shape and non-production fixture scope (`tenant-real` / `client-real` / `agent-real`). It contains no enrollment secret or subject key; its digest fields and installation ID are test-only.

Generator provenance (2026-10-12): isp-install commit `e3d7b30aeba7b9b36f49bf6372956d78254a3ca2`; Git blob SHA-1 `3552bf399be9a1a9c4e42541c969a2f3f39b5115`; generator file SHA-256 `0b256921e1d64018f906494d9c2f2e6e3a0606bc0ec3d551d5215b41c6d09cac`.

The ordinary web test reads this fixture only and does not require an isp-install checkout. Re-run the helper against the fixture when explicitly doing cross-repository integration verification; do not add a server absolute path to the web test suite or Flow configuration.
