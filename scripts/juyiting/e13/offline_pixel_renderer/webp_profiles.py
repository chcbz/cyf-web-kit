"""Reviewed decoder identities and full-source RGBA equivalence proofs.

Reference: Alinux libwebp-1.2.0-8.0.1.al8.x86_64.rpm, exact historical
cddced... binary, executed under qemu-x86_64. Compared with Debian arm64
libwebp 1.5.0 on 2026-09-08: all 10 production WebP files (9 unique sources)
have identical dimensions and complete, unpremultiplied RGBA bytes.
These are input/output proofs, not substitutes for final-composite validation.
Unknown libraries, input bytes, or decoded pixels remain fail-closed.
"""

REFERENCE_SHA = 'cddced092a8452bb7df72743d7810d736b4043cf9b00f41a4fdf72e120f438a0'
APPROVED_DECODERS = {
    REFERENCE_SHA: ('0x010200', '1.2.0'),
    '979c17adab6dff218b8bae090e8ec9a1ca1af0116f6c7e0e107f670eacddaed4': ('0x010500', '1.5.0'),
}
RGBA_PROOFS = {
    '72d5ca5ff3d5c71ec66018d65bbe6a9636e6bbab10338e2a07989b0be1efd9aa': (1664, 928, 'c79cac34d52e7d6c05b5baea96df1157d9f02d2d465604f9249941c983055c70'),
    '3e4f3f90b4d84411a844978237a7d3530bd481c37a62bcd73b9d694a7d2dd432': (1664, 928, 'd9c3206764f14537e44c4410f80cc87a2634df49e7ab8dff29118c9ed2056db3'),
    '748a571da633ceac300cc526ad7f0e7bc4f292cfc925288e340592d0ed5d568f': (1664, 928, '342b2078a3bb97743acb261af29c81cb2d689c0961dc56254c631f901d7f1670'),
    '51db05d29907b4f6d3271518860ed9cd9c27f0445b6240b68a9957004cab4e99': (1024, 1024, 'da6ad9d102ee811913f890bdf742e6776115061830af5a488d1f5d79d46fb450'),
    'fd9c7d965a1076cdae9b45c6eaff387a1b966a1e7d45a52e8b80678411892c7b': (1024, 1024, '7e59a737019f3c064a8c616bb2cf457ca9e49052c9082cd299ceec67698a67ee'),
    '8335c39fe935c9bea88c3ec5b8862846870115ffc47a2f50619cfdf9ffa3486c': (1024, 1024, '6f5f13f05503276089f721e30f7bf9fe4bee66fccc75431ac5ab4bbebd02c06e'),
    '68ddd7e090437804f52e3c0bbdf0e44ee85f9d91b81dffe00171966a6f33fa65': (1024, 1024, '15c1dc93f01a44fbf230f85be4fac63ce2481b9ad5784d804bd59050d9afc7ef'),
    '96c0cc8b44593f5a218a97c1f38e1b5023ccd932317ef1a98e85675180268224': (1024, 1024, 'f7b4f26c2e4c6f5b11b8cb22c19d2921016c9e3ce28753a6539b080ada8d1efa'),
    '846ec15c9ea2c758d6103bc19f2168bb6c5ee7aa175d2fda45264f0a39f7906d': (1024, 1024, '6d8b3578a9e75dc81ce7adce97854c969d4e9322b9fd048d53415779ae592074'),
}
