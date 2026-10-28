/**
 * Owns only the timer; SQL and logging are supplied by the composition point. Every minute, or every
 * `everyMs` — the erasure of the silent runs once a day (MOL-239).
 */
export function startLoginCleanup(
  clean: () => Promise<void>,
  failed: (error: unknown) => void,
  everyMs = 60_000,
): () => Promise<void> {
  let running: Promise<void> | undefined
  const tick = (): void => {
    if (running) return
    running = clean()
      .catch(failed)
      .finally(() => {
        running = undefined
      })
  }
  tick()
  const timer = setInterval(tick, everyMs)
  timer.unref()
  return async () => {
    clearInterval(timer)
    await running
  }
}
