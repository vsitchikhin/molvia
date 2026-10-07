import { serveFrames } from '@/scanner/serveFrames'
import { decodeReceiptQr } from '@/receipts/qrDecode'

serveFrames(decodeReceiptQr)
