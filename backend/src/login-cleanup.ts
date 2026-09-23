/** Owns only the timer; SQL and logging are supplied by the composition point. */
export function startLoginCleanup(
  clean: () => Promise<void>,
  failed: () => void,
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
  const timer = setInterval(tick, 60_000)
  timer.unref()
  return async () => {
    clearInterval(timer)
    await running
  }
}
