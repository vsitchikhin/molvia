"""The reader's one live test (В-6, MOL-125): run inside the image, by CI and by hand.

A receipt is drawn here — Armenian names, a till's figure line, no person's data — and read by the
same Tesseract and language files production reads with, through the HTTP of the server itself.

    docker run --rm receipt-reader python3 selftest.py
"""

import base64
import io
import json
import threading
import urllib.error
import urllib.request

from PIL import Image, ImageDraw, ImageFont

import reader

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
RECEIPT = [
    "ԵՐԵՎԱՆ-ՍԻԹԻ",
    "1.Կաթ «Իգիթ» 3.2% 1լ",
    "0401/1163909 1Հտ 366,30/3,70 370",
    "2.Հաց լավաշ",
    "1905/1100001 2Հտ 500,00/0,00 250",
    "Ընդամենը 866.30",
]


def drawn():
    font = ImageFont.truetype(FONT, 34)
    picture = Image.new("L", (900, 70 * len(RECEIPT) + 60), 255)
    pen = ImageDraw.Draw(picture)
    for i, line in enumerate(RECEIPT):
        pen.text((30, 30 + 70 * i), line, font=font, fill=0)
    buffer = io.BytesIO()
    picture.save(buffer, format="JPEG", quality=92)
    return buffer.getvalue()


def post(port, path, body):
    request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=body, method="POST")
    with urllib.request.urlopen(request, timeout=120) as answer:
        return json.load(answer)


def main():
    server = reader.Server(("127.0.0.1", 0), reader.Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    image = drawn()

    for psm in ("4", "6"):
        result = post(port, f"/read?langs=hye+rus+eng&psm={psm}", image)
        rows = [r for r in result["rows"] if r["text"].strip()]
        texts = [r["text"] for r in rows]
        assert any("0401/1163909" in t and "366,30/3,70" in t for t in texts), texts
        assert any("Ընդամենը 866.30" in t for t in texts), texts
        assert all(r["box"] is not None for r in rows), rows
        assert result["version"].startswith("tesseract"), result["version"]

    figures = next(r for r in rows if "0401/1163909" in r["text"])
    box = ",".join(str(n) for n in figures["box"])
    strip = post(port, f"/strips?boxes={box}", image)["strips"]
    cut = Image.open(io.BytesIO(base64.b64decode(strip[0])))
    assert cut.mode == "L" and cut.height < 120 and cut.width > 300, cut.size

    with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=10) as answer:
        assert json.load(answer)["status"] == "ok"

    # a box of no width, and one off the photo: refused, answered, nothing in the log (review А12)
    for boxes, code in (("304,0,0,10", 400), ("5000,0,10,10", 422)):
        try:
            post(port, f"/strips?boxes={boxes}", image)
            raise AssertionError(f"strips of {boxes} were cut")
        except urllib.error.HTTPError as refused:
            assert refused.code == code, (boxes, refused.code)

    try:
        post(port, "/read?langs=hye;rm&psm=4", image)
        raise AssertionError("a language list that is not one was taken")
    except urllib.error.HTTPError as refused:
        assert refused.code == 400

    try:
        post(port, "/read?langs=hye&psm=4", b"not a photo")
        raise AssertionError("text was read as a photo")
    except urllib.error.HTTPError as refused:
        assert refused.code == 422

    print("receipt-reader: ok,", reader.VERSION)


if __name__ == "__main__":
    main()
