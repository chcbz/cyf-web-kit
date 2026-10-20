#!/usr/bin/env python3
"""Own local static prototype preview; Python 3.6 compatible, no business runtime."""
import argparse
import http.server
import os
import socketserver
from urllib.parse import urlsplit

PROTOTYPE_ROOT = os.path.dirname(os.path.realpath(__file__))
FEATURE_ROOT = os.path.abspath(os.path.join(PROTOTYPE_ROOT, "../../../specs/juyiting-ui-baseline-20261006"))
DOCS = {"coverage.md", "interaction-guide-20261007.md", "spec.md", "design.md", "tasks.md", "acceptance.md"}

class PreviewHandler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # Browser resolves ../doc from root-level prototype links to /doc.
        name = urlsplit(path).path.lstrip("/")
        if name in DOCS:
            return os.path.join(FEATURE_ROOT, name)
        return super().translate_path(path)

class PreviewServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=18766)
    args = parser.parse_args()
    os.chdir(PROTOTYPE_ROOT)
    print('Offline prototype: http://127.0.0.1:{}/index.html#home'.format(args.port), flush=True)
    PreviewServer(('127.0.0.1', args.port), PreviewHandler).serve_forever()
