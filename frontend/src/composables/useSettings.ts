import type { ComputedRef, Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { ApiError } from '@molvia/client'
import { ERROR, sameSettings, settingsOf, settingsUpdateSchema } from '@molvia/model'
import type { ActorSettings } from '@molvia/model'
import { api } from '@/api'
import { reportFailure } from '@/failures'
import { useReconnect } from '@/composables/useReconnect'
import { useActorStore } from '@/stores/actor'
import { forget, read, writeEverywhere } from '@/stores/storage'

const keyOf = (owner: string): string => `molvia.settings-draft.${owner}`

// A store keeps a draft when the router unmounts the form. Each window keeps its own base **in
// memory**: another window saving must produce a conflict, never quietly rebase unsaved edits.
// On the device the draft belongs to the account, so the app being closed does not lose it: it
// is written to both shelves, and a new launch reads the last one written. A window that is
// already open reads its own shelf first, so two of them do not take each other's form.
const useSettingsStore = defineStore('settingsForm', () => {
  const actor = useActorStore()
  const base = ref<ActorSettings | null>(null)
  const draft = ref<ActorSettings | null>(null)
  const current = ref<ActorSettings | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  /**
   * Why the last read failed, decided as it failed (MOL-19: `navigator.onLine` read then): a read lost
   * with no connection is no server's silence, and once the connection is back the next read is a read
   * (MOL-215, review 1 №1, adversarial А2) — a flag of «failed» said «Сервер не ответил» over it.
   */
  const failure = ref<'offline' | 'error' | null>(null)
  /**
   * The failure is of the read a refused save started: «Не удалось сохранить» speaks for it, so the strip
   * does not, and the person's edit that takes the notice away takes this failure too (adversarial Д1).
   * Any other read's failure is the strip's at once, with its answer (Е2 of round 6).
   */
  const failureOfSave = ref(false)
  /** The person's retries that failed, counted, so the strip says its words again for each (C1). */
  const failures = ref(0)
  const stored = ref(true)
  const saved = ref(false)
  const saveError = ref(false)
  const pending = ref<ActorSettings | null>(null)
  const unknown = computed(() => !!pending.value && !saving.value)
  const returned = ref(false)
  let generation = 0
  const dirty = computed(
    () => !!base.value && !!draft.value && !sameSettings(base.value, draft.value),
  )
  const conflict = computed(
    () =>
      dirty.value && !!base.value && !!current.value && !sameSettings(base.value, current.value),
  )

  /**
   * What the form holds after another device saved: a choice this person has not touched
   * follows the account, one they are editing stays theirs.
   *
   * Sending the whole stale form was silent in the worst way — «Применить мои изменения» took
   * the other device's move back, and the city it was about to overwrite stood on the screen
   * without a mark, since «changed» is counted from the base (adversarial Б2). Per choice,
   * `conflict` then means what the word says: both devices changed the same one. The place is
   * one choice and not two fields — the country travels with the city — and `base` stays equal
   * to the row for everything untouched, so the conditional `UPDATE` still matches.
   *
   * A choice follows the account when it was not touched **or when the edit is what the account
   * now holds**: two devices that chose the same city are not in conflict, and a form warning
   * about a value already saved is an alarm that means nothing (adversarial Е3).
   */
  function settled(
    was: ActorSettings,
    edited: ActorSettings,
    now: ActorSettings,
  ): { base: ActorSettings; draft: ActorSettings } {
    const place =
      (was.country === edited.country && was.city === edited.city) ||
      (now.country === edited.country && now.city === edited.city)
    const spend =
      was.spendCurrency === edited.spendCurrency || now.spendCurrency === edited.spendCurrency
    const income =
      was.incomeCurrency === edited.incomeCurrency || now.incomeCurrency === edited.incomeCurrency
    return {
      base: {
        country: place ? now.country : was.country,
        city: place ? now.city : was.city,
        spendCurrency: spend ? now.spendCurrency : was.spendCurrency,
        incomeCurrency: income ? now.incomeCurrency : was.incomeCurrency,
      },
      draft: {
        country: place ? now.country : edited.country,
        city: place ? now.city : edited.city,
        spendCurrency: spend ? now.spendCurrency : edited.spendCurrency,
        incomeCurrency: income ? now.incomeCurrency : edited.incomeCurrency,
      },
    }
  }

  function adopt(): void {
    generation += 1
    loading.value = false
    saving.value = false
    failure.value = null
    failureOfSave.value = false
    saved.value = false
    saveError.value = false
    pending.value = null
    returned.value = false
    stored.value = true
    base.value = actor.settings ? { ...actor.settings } : null
    draft.value = base.value ? { ...base.value } : null
    current.value = base.value
    if (!actor.id) return
    try {
      // This window's own copy first: the shared shelf is what a new launch reads (Е1), while
      // a window that is already editing must find what it typed, not a neighbour's form.
      const raw = read(keyOf(actor.id), true)
      const data = raw ? (JSON.parse(raw) as Record<string, unknown>) : null
      const parsed = settingsUpdateSchema.safeParse(
        data ? { previous: data.previous, settings: data.settings } : null,
      )
      if (parsed.success) {
        base.value = parsed.data.previous
        draft.value = parsed.data.settings
        if (data?.pending === true) pending.value = { ...parsed.data.settings }
      }
    } catch {
      // An unreadable draft is not an account setting.
    }
  }
  watch(() => actor.id, adopt, { immediate: true, flush: 'sync' })

  function keep(): void {
    if (!actor.id || !base.value || !draft.value) return
    if (!dirty.value) {
      returned.value = false
      forget(keyOf(actor.id))
      stored.value = true
      return
    }
    // Under the account's key on the device, as the design says and as `verdictDrafts` are
    // kept: the system closes an installed app by itself, and a draft that lived in
    // `sessionStorage` was gone by the next launch with nothing on screen to warn of it
    // (adversarial Е1). `stored` again means what the notice says — a shelf refused it.
    stored.value = writeEverywhere(
      keyOf(actor.id),
      JSON.stringify({ previous: base.value, settings: draft.value, pending: !!pending.value }),
    )
  }
  /**
   * «Не удалось сохранить» spoke for the read after it too, and the person's own edit takes it away: the
   * refusal of that read goes with it, or the strip «Сервер не ответил» came out of the very tap and
   * moved the fields under it (MOL-215, adversarial Д1). The next read says what the server does.
   */
  function letSaveErrorGo(): void {
    if (failureOfSave.value && failure.value === 'error') failure.value = null
    failureOfSave.value = false
    saveError.value = false
  }
  function edit(value: ActorSettings): void {
    if (saving.value || unknown.value) return
    draft.value = value
    saved.value = false
    letSaveErrorGo()
    keep()
  }
  function cancel(): void {
    if (saving.value || unknown.value) return
    base.value = current.value
    draft.value = current.value ? { ...current.value } : null
    saved.value = false
    letSaveErrorGo()
    keep()
  }
  /**
   * `retry` — the person's own «Повторить»: only its failure is counted, so a retry that fails the same
   * way says the strip's words again (MOL-181, C1), and a read nobody asked for — the connection or the
   * app back — does not (MOL-204's А1). Every read keeps the failure standing until its own outcome: the
   * strip holds through it, never taken down and put up again under the finger (adversarial Г1).
   */
  async function refresh(retry = false, afterSave = false): Promise<boolean> {
    const owner = actor.id
    if (!owner || saving.value) return false
    const mine = ++generation
    loading.value = true
    try {
      const loaded = await api.me()
      if (mine !== generation || actor.id !== owner || loaded.id !== owner) return false
      const changed = dirty.value
      actor.apply(loaded)
      current.value = actor.settings ?? settingsOf(loaded)
      if (pending.value) {
        saved.value = sameSettings(current.value, pending.value)
        pending.value = null
        if (saved.value) {
          base.value = current.value
          draft.value = { ...current.value }
        }
        keep()
      }
      if (!changed) {
        base.value = current.value
        draft.value = { ...current.value }
      } else if (base.value && draft.value) {
        const next = settled(base.value, draft.value, current.value)
        base.value = next.base
        draft.value = next.draft
        keep()
      }
      failure.value = null
      failureOfSave.value = false
      return true
    } catch (error) {
      // A session that ended is heard by the seam in `@/api`, not by every caller (MOL-56).
      if (mine === generation) {
        // The phone's own defect reaches the owner; the API's word and the weather do not (MOL-144).
        reportFailure(error, 'screen')
        failure.value = navigator.onLine ? 'error' : 'offline'
        // Only a refusal «Не удалось сохранить» speaks for: a 409 says nothing, and the strip is then
        // the screen's one word, which an edit must not take (adversarial Ж2 of round 7).
        failureOfSave.value = afterSave && saveError.value
        if (retry) failures.value += 1
      }
      return false
    } finally {
      if (mine === generation) loading.value = false
    }
  }
  async function save(): Promise<void> {
    const owner = actor.id
    if (
      !owner ||
      !draft.value ||
      !base.value ||
      !dirty.value ||
      saving.value ||
      unknown.value ||
      loading.value ||
      !navigator.onLine
    )
      return
    // A second, explicit tap after seeing the conflict accepts the newly shown base.
    const previous = conflict.value && current.value ? current.value : base.value
    const settings = { ...draft.value }
    const mine = ++generation
    saving.value = true
    saveError.value = false
    pending.value = settings
    keep()
    loading.value = false
    failure.value = null
    failureOfSave.value = false
    try {
      const loaded = await api.saveSettings({ previous, settings })
      if (mine !== generation || actor.id !== owner || loaded.id !== owner) return
      actor.apply(loaded)
      current.value = actor.settings ?? settingsOf(loaded)
      base.value = current.value
      draft.value = { ...current.value }
      saved.value = true
      pending.value = null
      keep()
    } catch (error) {
      if (mine !== generation) return
      const answered = error instanceof ApiError && error.answered
      if (answered) pending.value = null
      saveError.value = answered && error.code !== ERROR.CONFLICT
      keep()
      // Refresh only reads. A lost response never causes an automatic second write.
      saving.value = false
      await refresh(false, true)
    } finally {
      if (mine === generation) saving.value = false
    }
  }
  return {
    draft,
    base,
    current,
    unknown,
    saveError,
    returned,
    dirty,
    conflict,
    loading,
    saving,
    failure,
    failureOfSave,
    failures,
    stored,
    saved,
    edit,
    cancel,
    refresh,
    save,
  }
})

interface SettingsNotice {
  title: string
  body: string
  tone: 'success' | 'error' | 'unknown'
}

export function useSettings(): {
  form: ReturnType<typeof useSettingsStore>
  online: Ref<boolean>
  notice: ComputedRef<SettingsNotice | null>
  hasAnnouncer: boolean
} {
  const form = useSettingsStore()
  const online = ref(navigator.onLine)
  const { t } = useI18n()
  const announce = useAnnouncer()
  let withdraw: (() => void) | undefined
  const notice = computed<SettingsNotice | null>(() => {
    if (form.unknown)
      return {
        tone: 'unknown',
        title: t('settings.save_unknown.title'),
        body: t('settings.save_unknown.body'),
      }
    if (form.saveError && online.value)
      return {
        tone: 'error',
        title: t('settings.save_error.title'),
        body: t('settings.save_error.body'),
      }
    if (form.saved) return { tone: 'success', title: t('settings.saved'), body: '' }
    return null
  })
  watch(
    notice,
    (value) => {
      withdraw?.()
      if (value && value.tone !== 'error') withdraw = announce?.(`${value.title}. ${value.body}`)
    },
    { immediate: true },
  )
  // A server's refusal from before the connection went is no word on the read its return starts
  // (adversarial Б1): from here the last thing known is «no connection».
  const offline = (): void => {
    online.value = false
    if (form.failure === 'error') form.failure = 'offline'
  }
  onMounted(() => {
    form.returned = form.dirty
    // The store outlives the screen: a refusal it kept — from another screen's stretch with no
    // connection, from an hour ago — is no word on the read of this opening (adversarial В1, В2).
    form.failure = null
    form.failureOfSave = false
    window.addEventListener('offline', offline)
    void form.refresh()
  })
  onUnmounted(() => {
    withdraw?.()
    window.removeEventListener('offline', offline)
  })
  useReconnect(() => {
    online.value = navigator.onLine
    if (online.value) void form.refresh()
    else offline()
  })
  return { form, online, notice, hasAnnouncer: !!announce }
}
