from http.server import BaseHTTPRequestHandler
import json
from datetime import datetime


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()

        response = {
            "status": "success",
            "message": "爬蟲運行成功",
            "timestamp": str(datetime.now())
        }

        self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))
        return
