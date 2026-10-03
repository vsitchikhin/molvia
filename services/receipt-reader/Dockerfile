# The receipt reader (MOL-125): Tesseract 5 with the language files MOL-114 measured — Debian's,
# `tessdata_fast` — and a small HTTP server of Python's own library. Debian trixie, as the bench:
# another release moves Tesseract and its files, and the measured figures with them.
FROM debian:trixie-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-hye tesseract-ocr-kat tesseract-ocr-srp tesseract-ocr-srp-latn \
      tesseract-ocr-rus tesseract-ocr-eng python3 python3-pil fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY services/receipt-reader/reader.py services/receipt-reader/selftest.py ./

# One page at a time on the cores the container is given (compose: three of four).
ENV OMP_THREAD_LIMIT=3 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER nobody
EXPOSE 8080
CMD ["python3", "reader.py"]
