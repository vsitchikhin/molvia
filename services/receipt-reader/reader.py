"""The receipt reader (MOL-125): a photo of a receipt in, Tesseract's reading out.

Stateless and without a database — the API holds the queue, the photos and the parse, and calls
this over the compose network (В-1). Nothing is written to disk but a temporary directory per
request, gone when the request is; nothing of a receipt is logged.

    POST /read?langs=hye+rus+eng&psm=4   body: JPEG  ->  {"text", "rows": [{"text", "box"}], "version"}
    POST /strips?boxes=l,t,w,h;l,t,w,h   body: JPEG  ->  {"strips": [base64 PNG, ...]}
    GET  /health                                      ->  {"status": "ok", "version"}

`rows` are the lines of `text`, one for one, each with its box on the photo when Tesseract's own
layout names it — so the API can cut a line out (the item lines kept for MOL-169).
"""

import base64
import hashlib
import io
import json
import os
import re
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

from PIL import Image

PORT = int(os.environ.get("PORT", "8080"))
# A part as the phone sends it is under 8 MB (RECEIPT_PART_BYTES_MAX); the rest is refused unread.
BODY_MAX = 9 * 1024 * 1024
# One page mode of one part; the queue's own timeout is longer than two of these.
READ_SECONDS = int(os.environ.get("READ_SECONDS", "90"))
TESSDATA = os.environ.get("TESSDATA_PREFIX", "/usr/share/tesseract-ocr/5/tessdata")
LANGS = re.compile(r"^[a-z_]{3,8}(\+[a-z_]{3,8}){0,5}$")
PAGE_MODES = {"4", "6"}
STRIPS_MAX = 64
# A strip keeps a few pixels around the box: Tesseract's boxes sit tight on the ink.
STRIP_MARGIN = 4


def version():
    """Tesseract's version and the digest of every language file — the model that read (MOL-169)."""
    first = subprocess.run(["tesseract", "--version"], capture_output=True, text=True).stdout.splitlines()
    digest = hashlib.sha256()
    for name in sorted(os.listdir(TESSDATA)):
        if name.endswith(".traineddata"):
            with open(os.path.join(TESSDATA, name), "rb") as data:
                digest.update(name.encode())
                digest.update(hashlib.sha256(data.read()).digest())
    return f"{first[0] if first else 'tesseract'} · {digest.hexdigest()[:12]}"


VERSION = version()


def tsv_lines(tsv):
    """Tesseract's TSV as its lines in order: the words of each joined by a space, with its box."""
    lines = {}
    order = []
    rows = tsv.splitlines()[1:]
    for row in rows:
        cells = row.split("\t")
        if len(cells) < 12:
            continue
        level, page, block, par, line = cells[0], cells[1], cells[2], cells[3], cells[4]
        key = (page, block, par, line)
        if level == "4":
            box = [int(cells[6]), int(cells[7]), int(cells[8]), int(cells[9])]
            lines[key] = {"words": [], "box": box}
            order.append(key)
        elif level == "5" and key in lines and cells[11].strip():
            lines[key]["words"].append(cells[11])
    return [(" ".join(lines[k]["words"]), lines[k]["box"]) for k in order if lines[k]["words"]]


def boxed_rows(text, tsv):
    """Each row of the plain text with the box of the TSV line that says the same, or none."""
    lines = tsv_lines(tsv)
    out = []
    at = 0
    for row in text.split("\n"):
        box = None
        if row.strip():
            # the plain text is the TSV's lines in the same order; a row that differs looks ahead a little
            for k in range(at, min(at + 4, len(lines))):
                if lines[k][0].strip() == row.strip():
                    box = lines[k][1]
                    at = k + 1
                    break
        out.append({"text": row, "box": box})
    return out


def read(image, langs, psm):
    with tempfile.TemporaryDirectory() as work:
        source = os.path.join(work, "part.jpg")
        with open(source, "wb") as f:
            f.write(image)
        base = os.path.join(work, "out")
        subprocess.run(
            ["tesseract", source, base, "-l", langs, "--psm", psm, "txt", "tsv"],
            capture_output=True,
            timeout=READ_SECONDS,
            check=True,
        )
        with open(base + ".txt", encoding="utf-8") as f:
            text = f.read()
        with open(base + ".tsv", encoding="utf-8") as f:
            tsv = f.read()
    # Tesseract ends the page with a form feed; the rows are what is above it
    text = text.rstrip("\f\n")
    return {"text": text, "rows": boxed_rows(text, tsv), "version": VERSION}


def strips(image, boxes):
    picture = Image.open(io.BytesIO(image)).convert("L")
    out = []
    for left, top, width, height in boxes:
        box = (
            max(0, left - STRIP_MARGIN),
            max(0, top - STRIP_MARGIN),
            min(picture.width, left + width + STRIP_MARGIN),
            min(picture.height, top + height + STRIP_MARGIN),
        )
        # a box off the picture cuts nothing, and Pillow cannot write an empty picture
        if box[2] <= box[0] or box[3] <= box[1]:
            raise ValueError("box outside the photo")
        buffer = io.BytesIO()
        picture.crop(box).save(buffer, format="PNG", optimize=True)
        out.append(base64.b64encode(buffer.getvalue()).decode())
    return {"strips": out}


def parse_boxes(raw):
    boxes = []
    for part in raw.split(";"):
        numbers = part.split(",")
        if len(numbers) != 4 or not all(n.isdigit() for n in numbers):
            return None
        left, top, width, height = (int(n) for n in numbers)
        if width == 0 or height == 0:
            return None
        boxes.append([left, top, width, height])
    return boxes if 0 < len(boxes) <= STRIPS_MAX else None


class Handler(BaseHTTPRequestHandler):
    server_version = "receipt-reader"
    sys_version = ""

    def answer(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            self.answer(200, {"status": "ok", "version": VERSION})
        else:
            self.answer(404, {"error": "not_found"})

    def do_POST(self):
        url = urlparse(self.path)
        query = {k: v[0] for k, v in parse_qs(url.query).items()}
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > BODY_MAX:
            self.answer(413, {"error": "too_large"})
            return
        image = self.rfile.read(length)
        try:
            if url.path == "/read":
                # «hye+rus+eng»: a «+» not escaped arrives as a space, and is the same list
                langs, psm = query.get("langs", "").replace(" ", "+"), query.get("psm", "")
                if not LANGS.match(langs) or psm not in PAGE_MODES:
                    self.answer(400, {"error": "bad_query"})
                    return
                self.answer(200, read(image, langs, psm))
            elif url.path == "/strips":
                boxes = parse_boxes(query.get("boxes", ""))
                if boxes is None:
                    self.answer(400, {"error": "bad_query"})
                    return
                self.answer(200, strips(image, boxes))
            else:
                self.answer(404, {"error": "not_found"})
        except subprocess.TimeoutExpired:
            self.answer(504, {"error": "timeout"})
        except (subprocess.CalledProcessError, OSError, ValueError, Image.DecompressionBombError):
            # the photo could not be read: never its content, only the kind
            self.answer(422, {"error": "unreadable"})
        except Exception:
            # anything else broke on this photo: said, never dropped, and nothing of it logged —
            # a traceback names the photo's place in memory and, worse, sometimes its text
            self.answer(500, {"error": "failed"})

    def log_message(self, format, *args):
        # the request line names no receipt, but the default log would keep it on stderr forever;
        # the API logs what it asked and how it went
        pass


class Server(HTTPServer):
    def handle_error(self, request, client_address):
        # a connection that broke under a request — the API gave up, or a read ran out — is not
        # printed: the reader logs nothing at all
        pass


def main():
    Server(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
