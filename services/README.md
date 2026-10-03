# services

Anything that is not a TypeScript workspace. The split from `apps/` is deliberate:
a different runtime is a different boundary, and it should be visible in the tree
rather than only in the docs.

Nothing here is part of the npm workspaces, and nothing here may reach the database
directly — the API is the only write path.

## receipt-reader (MOL-125)

Tesseract 5 behind a small HTTP server of Python's own library: the API sends it a photo of a
receipt and gets the text back, row by row with each row's box on the photo, and cuts item lines
out through it. It holds nothing — no database, no disk but a temporary directory per request, no
log of what it read; the queue, the photos and the parse are the API's (`.claude/rules/receipts.md`).

Python, not TypeScript, because what it wraps is a program and an image library, and Debian ships
both: no `pip`, no dependency of ours. Debian trixie and its `tessdata_fast` language files are the
ones MOL-114 measured — another release moves Tesseract and the figures with it.

    make reader                                          # this copy's reader, on the API's band +3
    docker run --rm molvia-receipt-reader:dev python3 selftest.py   # the live test CI runs
