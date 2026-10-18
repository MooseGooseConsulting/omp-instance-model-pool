#!/usr/bin/env python3
"""Loopback-only synthetic OpenAI Chat Completions server for OMP headless smoke tests.

Never counts as a live provider in PLAN.md LT-01–LT-07.
"""
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

HOST = "127.0.0.1"
PORT = int(os.environ.get("OMP_MOCK_PORT", "18771"))
LOG = os.environ.get("OMP_MOCK_LOG", "/tmp/omp-model-pool-requests.jsonl")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        try:
            request = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        except (ValueError, TypeError):
            request = {}
        model = request.get("model", "unknown")
        with open(LOG, "a", encoding="utf-8") as file:
            file.write(json.dumps({"path": self.path, "model": model, "stream": request.get("stream")}) + "\n")
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        chunks = [
            {"id": "synthetic", "object": "chat.completion.chunk", "created": 1, "model": model,
             "choices": [{"index": 0, "delta": {"role": "assistant", "content": "synthetic ok"},
                          "finish_reason": None}]},
            {"id": "synthetic", "object": "chat.completion.chunk", "created": 1, "model": model,
             "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
        ]
        for chunk in chunks:
            self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


if __name__ == "__main__":
    HTTPServer((HOST, PORT), Handler).serve_forever()
