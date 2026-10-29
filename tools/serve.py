# Dev server: static files with caching disabled (so edited ES modules always reload).
# Usage: python tools/serve.py [port]   (default 5173, binds 127.0.0.1)
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript',
                      '.webmanifest': 'application/manifest+json'}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    http.server.ThreadingHTTPServer.allow_reuse_address = False
    # browsers open many parallel module requests: a deeper listen backlog avoids ERR_CONNECTION_REFUSED (boot stuck)
    http.server.ThreadingHTTPServer.request_queue_size = 256
    with http.server.ThreadingHTTPServer(('127.0.0.1', port), NoCacheHandler) as srv:
        print(f'WOS dev server: http://localhost:{port}')
        srv.serve_forever()
