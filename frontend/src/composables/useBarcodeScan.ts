import { onScopeDispose, ref, watch, type Ref } from 'vue'
import { barcodeSchema } from '@molvia/model'
import { createBarcodeReader, type BarcodeReader } from '@/scanner/barcodeReader'
import type { FrameSource } from '@/scanner/capture'
import { createReadStreak } from '@/scanner/frames'

export interface BarcodeScan {
  /** The reader failed — its wasm would not load, or its worker died. The sheet's error state. */
  failed: Ref<boolean>
  /** Loads the reader ahead, while the camera starts. */
  warm: () => void
  /** After a failure: a new reader, and reading again once the camera is live. */
  reset: () => void
}

/**
 * Reads frames while the camera is live and hands over the first code with a barcode's shape two
 * frames in a row agree on (MOL-98). One frame at a time: the next is taken once the reader has
 * answered the last, so a slow phone reads what the camera sees now rather than a queue of what it
 * saw.
 */
export function useBarcodeScan(options: {
  live: Ref<boolean>
  frames: () => FrameSource | null
  onCode: (code: string) => void
  createReader?: () => BarcodeReader
}): BarcodeScan {
  const failed = ref(false)
  const make = options.createReader ?? (() => createBarcodeReader())
  let reader: BarcodeReader | null = null
  // Each run of the loop is numbered: a run the camera stopped under leaves at its next step.
  let run = 0

  function readerNow(): BarcodeReader {
    reader ??= make()
    return reader
  }

  function fail(): void {
    failed.value = true
    run++
  }

  async function loop(current: number, source: FrameSource): Promise<void> {
    const streak = createReadStreak()
    const active = readerNow()
    while (current === run) {
      let code: string | null
      // A throw anywhere in a step — the frame cut as much as the read — is the reader's error on
      // the screen, never a loop that died without a word under a live viewfinder (adversarial Е).
      try {
        await source.next()
        if (current !== run) return
        const image = source.grab()
        if (!image) continue
        code = await active.read(image)
      } catch {
        if (current === run) fail()
        return
      }
      if (current !== run) return
      // Checked here rather than in the worker, which would carry the whole model for one regex.
      const taken = streak(code !== null && barcodeSchema.safeParse(code).success ? code : null)
      if (taken !== null) {
        run++
        options.onCode(taken)
        return
      }
    }
  }

  watch(options.live, (live) => {
    run++
    if (!live || failed.value) return
    const source = options.frames()
    if (source) void loop(run, source)
  })

  function warm(): void {
    const warming = readerNow()
    // Only the reader that is still ours fails the scan: one let go by `reset` rejects its warm
    // as it goes, and that must not mark the next one failed (adversarial Б).
    warming.warm().catch(() => {
      if (reader === warming) fail()
    })
  }

  function reset(): void {
    reader?.dispose()
    reader = null
    failed.value = false
    run++
  }

  onScopeDispose(() => {
    run++
    reader?.dispose()
    reader = null
  })

  return { failed, warm, reset }
}
