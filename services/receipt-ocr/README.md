# receipt-ocr — 1.0, not started

Receipt recognition lands here as a Python service: OCR is native territory for Python
and has nothing comparable in TypeScript. That is the single reason the project is not
TypeScript end to end.

**Why not earlier.** Receipts fill in prices, while the 0.1–0.3 gates measure ratings —
an OCR service could not move any of them, so building it early would buy nothing and
cost the most expensive part of the roadmap.

**Why photo plus OCR and not something cheap.** A QR code on a fiscal receipt would have
meant a plain request returning structured line items instead of recognition. Checked on
a real receipt from Yerevan City: there is no QR, only Armenian text and a barcode holding
the receipt number. The cheap path is closed.

Reopen the question if receipts from SAS or Carrefour turn out to carry a QR — only one
chain was checked, and the option is too good to write off on a single sample.

**When it exists it stays a client of the API**, like the bot: it recognises, then posts
what it recognised. It gets no database access of its own.
