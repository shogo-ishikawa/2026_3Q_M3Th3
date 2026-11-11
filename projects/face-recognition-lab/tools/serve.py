"""配布フォルダーのブラウザ版を、この端末の中だけで表示します。"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
from pathlib import Path
from urllib.parse import unquote, urlsplit
import argparse

ROOT = Path(__file__).resolve().parents[1]


class AppHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.mjs': 'text/javascript', '.wasm': 'application/wasm',
                      '.onnx': 'application/octet-stream'}

    def send_head(self):
        parts = Path(unquote(urlsplit(self.path).path).lstrip('/')).parts
        target = ROOT.joinpath(*parts)
        if (any(part.startswith('.') for part in parts)
                or (parts and parts[0] == 'local')
                or not target.resolve().is_relative_to(ROOT)):
            self.send_error(404)
            return None
        return super().send_head()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=4173)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--strictPort', action='store_true')
    args = parser.parse_args()
    if args.host not in ('127.0.0.1', 'localhost', '0.0.0.0'):
        parser.error('--hostはプレビュー用のローカルアドレスに限ります。')
    handler = partial(AppHandler, directory=str(ROOT))
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f'FACEGATE: http://127.0.0.1:{server.server_port}/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
