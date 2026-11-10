"""開発用のHTTPサーバー。プレビュー環境から渡されるhost/portにも対応します。"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--host', default='127.0.0.1')
parser.add_argument('--port', default=8000, type=int)
parser.add_argument('--strictPort', action='store_true')
args = parser.parse_args()
directory = Path(__file__).resolve().parents[1]
handler = partial(SimpleHTTPRequestHandler, directory=str(directory))
print(f'http://{args.host}:{args.port}', flush=True)
ThreadingHTTPServer((args.host, args.port), handler).serve_forever()
