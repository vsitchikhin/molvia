import { onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { usePwaUpdate, type PwaUpdate, type UpdatePhase } from '@/pwaUpdate'

/** What each version's state last had said out loud, across every strip, error and screen. */
const said = new WeakMap<PwaUpdate, UpdatePhase>()

/**
 * «Вышла новая версия» said as it comes and «Не получилось обновить» as it fails — once for the
 * app, by whatever offers it now: the strip's row (MOL-132), or an error of the whole screen, which
 * offers «Обновить» itself and takes the row's place (MOL-180, 8c; adversarial А3 — the version
 * came out under the error in silence). What was said is kept by the version's own state, the one
 * object everything reads, so a screen drawn anew, born with the version waiting, says nothing
 * twice (adversarial Д1).
 *
 * `active` is whether the caller offers the version right now.
 */
export function useUpdateAnnouncement(active: () => boolean = () => true): void {
  const { t } = useI18n()
  const update = usePwaUpdate()
  const announce = useAnnouncer()

  let unsay: (() => void) | undefined
  let saying: UpdatePhase | undefined
  watch(
    [() => update.phase.value, active],
    ([now, offering]) => {
      if (!offering || (now !== 'ready' && now !== 'failed')) return
      if (said.get(update) === now) return
      said.set(update, now)
      unsay?.()
      saying = now
      unsay = announce?.(now === 'failed' ? t('update.failed.title') : t('update.ready'))
    },
    { immediate: true },
  )
  // Words still true stay when what said them goes: the next screen draws the same offer and says
  // nothing, and taken back they were gone before a screen reader read them — a millisecond after
  // they came, or before they came at all (review С-13, adversarial Ж2). Only words that stopped
  // being true are taken back.
  onBeforeUnmount(() => {
    if (update.phase.value !== saying) unsay?.()
  })
}
