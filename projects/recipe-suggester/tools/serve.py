"""Web版をローカルで開くための小さなサーバー。"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=8000)
parser.add_argument("--host", default="127.0.0.1")
parser.add_argument("--strictPort", action="store_true")
arguments = parser.parse_args()
root = Path(__file__).resolve().parents[1]
server = ThreadingHTTPServer((arguments.host, arguments.port), partial(SimpleHTTPRequestHandler, directory=str(root)))
print(f"http://{arguments.host}:{arguments.port}/", flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    server.server_close()
