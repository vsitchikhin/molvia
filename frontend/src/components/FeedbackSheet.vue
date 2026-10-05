<template>
  <BottomSheet :open="sheet.shown" @update:open="sheet.shown = $event">
    <template #title>{{ fromError ? t('feedback.title_error') : t('feedback.title') }}</template>

    <!-- There before its words, with only the text changing: a region born together with what it
         says is often not read at all (MOL-19). -->
    <p class="offline" :class="{ shown: offlineWords !== '' }" role="status">
      <IconCloud v-if="offlineWords" aria-hidden="true" />{{ offlineWords }}
    </p>
    <!-- What the answer was, said: the region is in the sheet from its opening, and only its words
         come with the answer — «sent» and «the day's limit» born with a role of their own were often
         not read at all (MOL-19, review №3). A failure is an alert, which is read when inserted. -->
    <p class="spoken" role="status">{{ spoken }}</p>

    <div v-if="phase === 'sent'" class="sent">
      <span class="circle" aria-hidden="true"><IconCheck /></span>
      <p class="sent-title">{{ t('feedback.sent.title') }}</p>
      <p class="sent-body">{{ t('feedback.sent.body') }}</p>
    </div>
    <template v-else>
      <SegmentedControl
        ref="kinds"
        v-model="kind"
        :legend="t('feedback.kind_label')"
        :options="kindOptions"
        :disabled="phase === 'sending'"
      />
      <AppField
        ref="field"
        v-model="text"
        class="text"
        kind="multiline"
        :label="t('feedback.text_label')"
        :placeholder="placeholder"
        :maxlength="textMax"
        :counter-from="COUNTER_FROM"
        :readonly="phase === 'sending'"
        :error-text="unsupported ? t('feedback.unsupported') : null"
      />
      <!-- Only what the person attaches, seen before it goes (MOL-167, MOL-150 В-6). -->
      <FeedbackPictures
        :pictures="pictures"
        :max="picturesMax"
        :drawing="drawing"
        :disabled="phase === 'sending'"
        :note="pictureNote"
        @add="attach"
        @remove="detach"
      />
      <!-- What goes with the text, always and before sending (MOL-150, Р-7): read from the body
           itself, so it cannot say one thing and send another. -->
      <p class="attached">
        <IconPaperclip class="clip" aria-hidden="true" />
        <span
          ><strong class="attached-lead">{{ t('feedback.attached') }}</strong>
          {{ attachedWords }}</span
        >
      </p>
    </template>

    <template #footer>
      <div v-if="phase === 'limited'" class="note warn">
        <IconAlert aria-hidden="true" />
        <div>
          <p class="note-title">{{ t('feedback.limit.title') }}</p>
          <p class="note-body">{{ t('feedback.limit.body') }}</p>
        </div>
      </div>
      <div v-else-if="phase === 'failed'" class="note bad" role="alert">
        <IconFailed aria-hidden="true" />
        <div>
          <p class="note-title">{{ t('feedback.failed.title') }}</p>
          <p class="note-body">{{ t('feedback.failed.body') }}</p>
        </div>
      </div>
      <AppButton
        size="large"
        block
        :inactive="waiting !== null"
        :busy="phase === 'sending'"
        :busy-label="t('feedback.sending')"
        @click="press"
      >
        <template v-if="action.icon" #icon><component :is="action.icon" /></template>
        {{ action.words }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
  type Component,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@molvia/client'
import {
  ERROR,
  ISSUE,
  FEEDBACK_PICTURES_MAX,
  FEEDBACK_TEXT_MAX,
  drawsNothing,
  feedbackBodySchema,
  feedbackPlatformSchema,
  pickLocale,
  tidyText,
} from '@molvia/model'
import type {
  FEEDBACK_SYSTEMS,
  FeedbackAttached,
  FeedbackBody,
  FeedbackKind,
  AppLocale,
} from '@molvia/model'
import IconAlert from '~icons/mdi/alert-outline'
import IconFailed from '~icons/mdi/alert-circle-outline'
import IconCheck from '~icons/mdi/check'
import IconCloud from '~icons/mdi/cloud-off-outline'
import IconPaperclip from '~icons/mdi/paperclip'
import IconRefresh from '~icons/mdi/refresh'
import IconSend from '~icons/mdi/send'
import { api } from '@/api'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import FeedbackPictures from '@/components/FeedbackPictures.vue'
import { PictureRefused, base64Of, pictureFromFile } from '@/feedbackPicture'
import type { PictureRefusal } from '@/feedbackPicture'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { newId } from '@/ids'
import { platformLine } from '@/platform'
import { usePwaUpdate } from '@/pwaUpdate'
import { useActorStore } from '@/stores/actor'
import {
  dropFeedbackDraft,
  keepFeedbackDraft,
  recallFeedbackDraft,
  feedbackSent,
} from '@/stores/feedbackDraft'
import { useFeedbackSheetStore } from '@/stores/feedbackSheet'

/** As long as the app's live region waits before its words (`useAnnouncer`). */
const STATUS_DELAY_MS = 100

/** The last characters of the bound that are counted under the field (handoff 02). */
const COUNTER_FROM = 200

type System = (typeof FEEDBACK_SYSTEMS)[number]

const SYSTEM_KEYS: Record<System, string> = {
  ios: 'feedback.systems.ios',
  ipados: 'feedback.systems.ipados',
  android: 'feedback.systems.android',
  macos: 'feedback.systems.macos',
  windows: 'feedback.systems.windows',
  linux: 'feedback.systems.linux',
  other: 'feedback.systems.other',
}

const LANGUAGE_KEYS: Record<AppLocale, string> = {
  ru: 'feedback.languages.ru',
  en: 'feedback.languages.en',
}

const PLACEHOLDER_KEYS: Record<FeedbackKind | '', string> = {
  '': 'feedback.placeholder.any',
  bug: 'feedback.placeholder.bug',
  idea: 'feedback.placeholder.idea',
  other: 'feedback.placeholder.any',
}

/**
 * A `201` whose body did not read — cut off on its way, or the shape of a newer server: the API wrote
 * the message, and it is sent as far as the sheet is concerned (round 3, Ф1). Only `201`, as the
 * login trusts it (`mayHaveStarted`, MOL-68): no portal says it, and a portal's own `200` page taken
 * for «sent» erased a message that never left (round 4, П1, П2; review №9). A `200` is a repeat, and
 * a repeat is safe to send again.
 */
function writtenAnyway(error: unknown): boolean {
  return error instanceof ApiError && error.code === ISSUE.RESPONSE_INVALID && error.status === 201
}

/**
 * - `limited` — the day's ten are sent (`429`): held while the sheet is open, since the window is
 *   the server's rolling day and the phone cannot know when it frees; the next opening asks again.
 * - `failed` — no answer, or one that is not a write: the text stays, and «Повторить» sends the same
 *   message by the same key until the person changes it (Р-2).
 */
type Phase = 'idle' | 'sending' | 'sent' | 'limited' | 'failed'

/** A picture held for the message: the drawing shown, and what the body carries. */
interface HeldPicture {
  readonly url: string
  readonly base64: string
  readonly width: number
  readonly height: number
}

/** Why the phone could not take a picture, by the words the row says it with. */
const PICTURE_NOTES: Record<PictureRefusal, string> = {
  unreadable: 'feedback.picture.unreadable',
  shape: 'feedback.picture.shape',
}

/**
 * «Написать разработчику» (MOL-147) — the one sheet of the app, opened from the settings or from an
 * error screen («Сообщить о проблеме»), mounted once in `App.vue` and opened through its store.
 *
 * The kind is the person's to choose (MOL-146): from the settings none is chosen; an error screen
 * opens it on «Сломалось», since the tap said so. The kind and the text are a draft on the device
 * (`feedbackDraft`); the screen, the build, the platform and the code are the opening's (Р-6).
 *
 * Offline it waits: there is no queue (MOL-150, В-2), and the button says why it is inactive — the
 * reasons in the order a person can put them right: the kind, the text, the day's limit, the
 * connection (handoff 02, Ф-6).
 */
export default defineComponent({
  name: 'FeedbackSheet',
  components: {
    AppButton,
    AppField,
    BottomSheet,
    FeedbackPictures,
    IconAlert,
    IconCheck,
    IconCloud,
    IconFailed,
    IconPaperclip,
    SegmentedControl,
  },
  setup() {
    const { t, locale } = useI18n()
    const route = useRoute()
    const router = useRouter()
    const sheet = useFeedbackSheetStore()
    const actor = useActorStore()
    const update = usePwaUpdate()

    const kind = ref<FeedbackKind | ''>('')
    const text = ref('')
    const clientKey = ref(newId())
    const phase = ref<Phase>('idle')
    const unsupported = ref(false)
    const connected = ref(navigator.onLine)
    /**
     * The pictures, in the page's memory only (MOL-167, Р-6): the draft on the shelf keeps their
     * number, and after a reload the sheet says they were not kept.
     */
    const pictures = ref<HeldPicture[]>([])
    const drawing = ref(false)
    /**
     * The draft had begun to leave, under its key, with pictures this page no longer holds — a reload,
     * or another window sending it right now. Until the content changes, a `409` under that key says
     * the server holds that very message, pictures and all (adversarial В2, Б3).
     */
    const leftWithPictures = ref(false)
    const pictureNote = ref<string | null>(null)
    const kinds = ref<{ $el?: HTMLElement } | null>(null)
    const field = ref<{ $el?: HTMLElement } | null>(null)

    /** What this opening attaches: the screen it was opened over, the build, the platform, the code. */
    const opened = ref<FeedbackAttached | null>(null)
    /**
     * What went with the text the first time it left under the present key — the message, to the
     * last field, as the server may already hold it (adversarial В1, В2). Let go with the key, when
     * the kind or the text changes; until then it is what the sheet shows and sends again.
     */
    const frozen = ref<FeedbackAttached | null>(null)
    const attached = computed(() => frozen.value ?? opened.value)
    const fromError = computed(() => attached.value?.fromError ?? sheet.entry.from === 'error')

    // Which opening of the sheet this is: an answer to one closed meanwhile is not this one's.
    let opening = 0
    // Set while the draft is read in, so reading it does not count as a change of the content.
    let recalling = false

    watch(
      () => sheet.shown,
      async (shown) => {
        opening += 1
        if (!shown) return
        const entry = sheet.entry
        opened.value = {
          locale: pickLocale(locale.value),
          pageBuild: update.build(),
          route: typeof route.name === 'string' ? route.name : '',
          platform: platformLine(),
          fromError: entry.from === 'error',
          errorCode: entry.from === 'error' ? entry.code : null,
        }
        connected.value = navigator.onLine
        phase.value = 'idle'
        unsupported.value = false
        pictureNote.value = null
        const draft = recallFeedbackDraft(actor.id)
        recalling = true
        frozen.value = draft?.attached ?? null
        // «Сломалось» from an error screen is this opening's, in memory: closed untouched, the draft
        // keeps the kind the person chose (adversarial В4). A message that may have left already is
        // the same one, kind and all.
        kind.value = entry.from === 'error' && frozen.value === null ? 'bug' : (draft?.kind ?? '')
        text.value = draft?.text ?? ''
        clientKey.value = draft?.clientKey ?? newId()
        await nextTick()
        recalling = false
        // A reload left the pictures behind — or another window holds them, and may be sending them
        // now. Said, and the key kept: the opening decides nothing for another window (review 7,
        // adversarial В2). What a `409` then means is decided by the answer, in `press`.
        const lost = (draft?.pictures ?? 0) > pictures.value.length
        if (lost) pictureNote.value = t('feedback.picture.lost')
        leftWithPictures.value = lost && draft?.attached !== undefined
        // a receipt's photos (MOL-222, В-2): added as a picture chosen is, and as removable
        const photos = sheet.takePhotos()
        if (photos.length > 0) void attach(photos)
        focusFirst()
      },
    )

    /** Into the field once a kind is there, else to the kinds: what the person is asked next. */
    function focusFirst(): void {
      const target =
        kind.value === ''
          ? kinds.value?.$el?.querySelector<HTMLElement>('input')
          : field.value?.$el?.querySelector<HTMLElement>('textarea')
      target?.focus()
    }

    function keep(): void {
      keepFeedbackDraft(actor.id, {
        kind: kind.value,
        text: text.value,
        clientKey: clientKey.value,
        ...(frozen.value === null ? {} : { attached: frozen.value }),
        ...(pictures.value.length === 0 ? {} : { pictures: pictures.value.length }),
      })
    }

    /** New content: a key of its own, and what goes with it is this opening's again. */
    function changed(): void {
      clientKey.value = newId()
      frozen.value = null
      leftWithPictures.value = false
      keep()
    }

    watch([kind, text], () => {
      if (recalling) return
      changed()
      unsupported.value = false
      // An edit is the answer to «не получилось»; the day's limit it does not lift.
      if (phase.value === 'failed') phase.value = 'idle'
    })

    /** A picture added or taken away is another content: a key of its own, as an edit is (Р-6). */
    function picturesChanged(): void {
      changed()
      if (phase.value === 'failed') phase.value = 'idle'
    }

    async function attach(files: readonly Blob[]): Promise<void> {
      pictureNote.value = null
      drawing.value = true
      // more than a message takes — a receipt of four parts (MOL-222, review 6): said, never dropped
      // in silence
      const room = FEEDBACK_PICTURES_MAX - pictures.value.length
      const overflow =
        files.length > room
          ? t('feedback.picture.too_many', { n: Math.max(room, 0), total: files.length })
          : null
      try {
        // Each file on its own: one the browser cannot open does not keep the next from being tried
        // (adversarial А6), and the first refusal is what is said.
        for (const file of files.slice(0, FEEDBACK_PICTURES_MAX - pictures.value.length)) {
          try {
            const drawn = await pictureFromFile(file)
            pictures.value = [
              ...pictures.value,
              {
                url: URL.createObjectURL(drawn.jpeg),
                base64: await base64Of(drawn.jpeg),
                width: drawn.width,
                height: drawn.height,
              },
            ]
            picturesChanged()
          } catch (error) {
            const reason = error instanceof PictureRefused ? error.reason : 'unreadable'
            pictureNote.value ??= t(PICTURE_NOTES[reason])
          }
        }
        pictureNote.value ??= overflow
      } finally {
        drawing.value = false
      }
    }

    function detach(index: number): void {
      const gone = pictures.value[index]
      if (gone === undefined) return
      URL.revokeObjectURL(gone.url)
      pictures.value = pictures.value.filter((_, at) => at !== index)
      pictureNote.value = null
      picturesChanged()
    }

    function letPicturesGo(): void {
      for (const picture of pictures.value) URL.revokeObjectURL(picture.url)
      pictures.value = []
    }

    // Another person on this device: what was held for the last one is not theirs.
    watch(() => actor.id, letPicturesGo)

    const kindOptions = computed(() => [
      { value: 'bug', label: t('feedback.kinds.bug') },
      { value: 'idea', label: t('feedback.kinds.idea') },
      { value: 'other', label: t('feedback.kinds.other') },
    ])

    const placeholder = computed(() => t(PLACEHOLDER_KEYS[kind.value]))

    function platformWords(line: string): string {
      if (!feedbackPlatformSchema.safeParse(line).success) return ''
      const [system = 'other', ...rest] = line.split(' ')
      const mode = rest.pop()
      const os = [t(SYSTEM_KEYS[system as System]), ...rest].join(' ')
      return mode === 'app'
        ? t('feedback.platform.app', { os })
        : t('feedback.platform.browser', { os })
    }

    /** The title of a screen by its route's name — the screen the message is about. */
    function screenOf(name: string): string {
      const titleKey = router.getRoutes().find((record) => record.name === name)?.meta.titleKey
      return titleKey === undefined ? name : t(titleKey)
    }

    const attachedWords = computed(() => {
      const sent = attached.value
      if (sent === null) return ''
      const count = pictures.value.length
      return [
        count === 0 ? null : t('feedback.attached_pictures', { n: count }, count),
        sent.pageBuild === null ? null : t('feedback.attached_build', { build: sent.pageBuild }),
        t('feedback.attached_screen', { screen: screenOf(sent.route) }),
        t(LANGUAGE_KEYS[sent.locale]),
        platformWords(sent.platform),
        sent.errorCode === null ? null : t('feedback.attached_code', { code: sent.errorCode }),
      ]
        .filter((part) => part !== null && part !== '')
        .join(' · ')
    })

    /** The text as it goes, or nothing: a picture may go alone (MOL-167, В-3). */
    const words = computed(() => tidyText(text.value))
    // What draws nothing is no words, by the domain's own rule (review 5): a word joiner pasted beside
    // a screenshot must not keep the screenshot from going.
    const saysWords = computed(() => !drawsNothing(words.value))

    /**
     * The message as it goes, read at the press and not before (review 6): the pictures' base64 is
     * megabytes, and a body read again with every letter typed checked them every time.
     */
    function bodyNow() {
      if (kind.value === '' || attached.value === null) return null
      const parsed = feedbackBodySchema.safeParse({
        kind: kind.value,
        text: saysWords.value || pictures.value.length === 0 ? words.value : undefined,
        ...attached.value,
        clientKey: clientKey.value,
        pictures:
          pictures.value.length === 0 ? undefined : pictures.value.map((picture) => picture.base64),
      } satisfies Record<keyof FeedbackBody, unknown>)
      return parsed.success ? parsed.data : null
    }

    /** Why the button does not send, if it does not — `null` when it does. */
    const waiting = computed<string | null>(() => {
      if (phase.value === 'sent' || phase.value === 'sending') return null
      if (kind.value === '') return t('feedback.need_kind')
      if (drawing.value) return t('feedback.picture.adding')
      if (!saysWords.value && pictures.value.length === 0) return t('feedback.need_text')
      if (phase.value === 'limited') return t('feedback.need_tomorrow')
      if (!connected.value) return t('feedback.need_network')
      return null
    })

    const action = computed<{ words: string; icon: Component | null }>(() => {
      if (phase.value === 'sent') return { words: t('feedback.done'), icon: IconCheck }
      if (waiting.value !== null) return { words: waiting.value, icon: null }
      if (phase.value === 'failed') return { words: t('state.retry'), icon: IconRefresh }
      return { words: t('feedback.send'), icon: IconSend }
    })

    async function press(): Promise<void> {
      if (phase.value === 'sent') {
        sheet.shown = false
        return
      }
      if (waiting.value !== null || phase.value === 'sending') return
      // Another window of the app may have sent this very draft since the sheet opened, its answer
      // lost: the key on the device is the same, and what went with it is there — sent with ours, it
      // would meet `409` and a second message (round 5, Т1).
      const stored = recallFeedbackDraft(actor.id)
      if (stored?.clientKey === clientKey.value && stored.attached !== undefined) {
        frozen.value = stored.attached
      }
      // Or sent it, and it reached the owner: this is that very message, said as sent (round 6, У1).
      if (feedbackSent(actor.id, clientKey.value)) {
        phase.value = 'sent'
        return
      }
      const message = bodyNow()
      if (message === null) {
        // A kind and a text that draws something are there, and still the schema refuses: a
        // character that cannot be sent — said under the field rather than left to a grey button.
        unsupported.value = true
        return
      }
      const mine = opening
      const owner = actor.id
      // From here the server may hold it: what went with it stays with the key (В1).
      frozen.value = attached.value
      keep()
      phase.value = 'sending'
      try {
        try {
          await api.sendFeedback(message)
        } catch (error) {
          if (!writtenAnyway(error)) throw error
        }
        // Sent is sent, whatever became of the sheet meanwhile: the draft goes with it — unless it
        // has changed since, and is another message now. So do the pictures it went with, closed or
        // not (adversarial А1): kept, the next message opened with a screenshot already sent, one
        // kind away from sending it again. «Changed since» is the key's, for both (Б2): a word added
        // meanwhile makes another message, and its pictures are that message's — never taken from
        // under the finger.
        dropFeedbackDraft(owner, message.clientKey)
        if (clientKey.value !== message.clientKey) return
        // The same message, whichever opening it is in now: closed and opened again untouched, the
        // sheet says it went rather than let its pictures go from under the finger (adversarial В1).
        letPicturesGo()
        phase.value = 'sent'
      } catch (error) {
        if (mine !== opening) return
        const code = error instanceof ApiError ? error.code : null
        connected.value = navigator.onLine
        // The day's limit is counted after a repeat is looked for, so a `429` says no message is
        // held under this key: what goes with the text is the next opening's again, and tomorrow's
        // message from the settings does not carry today's error screen (adversarial Н2). Nothing
        // else says it — a `401` or a `400` is refused before the write and knows nothing of an
        // earlier send whose answer was lost (round 4, П3); a `409` takes a new key below.
        if (code === ERROR.FEEDBACK_RATE_LIMITED) {
          frozen.value = null
          keep()
          phase.value = 'limited'
          return
        }
        // The same key, the same words, and the pictures it began to leave with lost on this page: the
        // server holds that very message, pictures and all — sent, not a second one (В2, Б3).
        if (code === ERROR.CONFLICT && leftWithPictures.value) {
          dropFeedbackDraft(owner, message.clientKey)
          letPicturesGo()
          phase.value = 'sent'
          return
        }
        // The same key with another content — a defect of the phone, never the person's (Р-2): a
        // new key, or «Повторить» would meet the same refusal for ever (сверка С-9).
        if (code === ERROR.CONFLICT) changed()
        // A picture the API would not take: refused before anything is written, said under the
        // pictures, and the next one chosen is another message (MOL-167, Р-2). The phone always names
        // the body's length, so a body too large is the route's own code too.
        if (code === ERROR.FEEDBACK_PICTURE_INVALID || code === ERROR.FEEDBACK_PICTURE_TOO_LARGE) {
          pictureNote.value = t(code)
          phase.value = 'idle'
          return
        }
        phase.value = 'failed'
      }
    }

    // The offline strip's words come a moment after the sheet does, as the app's own region lets
    // them (MOL-19): a closed <dialog> is outside the accessibility tree.
    const settled = ref(false)
    let settling: ReturnType<typeof setTimeout> | undefined
    watch(
      () => sheet.shown,
      (shown) => {
        clearTimeout(settling)
        settled.value = false
        if (shown) {
          settling = setTimeout(() => {
            settled.value = true
          }, STATUS_DELAY_MS)
        }
      },
    )
    const offlineWords = computed(() =>
      settled.value && !connected.value && phase.value !== 'sent' ? t('feedback.offline') : '',
    )
    const spoken = computed(() => {
      if (phase.value === 'sent') return `${t('feedback.sent.title')}. ${t('feedback.sent.body')}`
      if (phase.value === 'limited')
        return `${t('feedback.limit.title')}. ${t('feedback.limit.body')}`
      return ''
    })

    function sync(): void {
      connected.value = navigator.onLine
    }
    onMounted(() => {
      window.addEventListener('online', sync)
      window.addEventListener('offline', sync)
    })
    onUnmounted(() => {
      clearTimeout(settling)
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    })

    return {
      t,
      sheet,
      kind,
      text,
      kinds,
      field,
      phase,
      unsupported,
      fromError,
      kindOptions,
      placeholder,
      attachedWords,
      offlineWords,
      spoken,
      waiting,
      action,
      press,
      textMax: FEEDBACK_TEXT_MAX,
      pictures,
      picturesMax: FEEDBACK_PICTURES_MAX,
      drawing,
      pictureNote,
      attach,
      detach,
      COUNTER_FROM,
    }
  },
})
</script>

<style scoped lang="scss">
.offline {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  color: var(--warn-ink);
  font-size: var(--text-footnote);

  &.shown {
    @include appear;

    padding: var(--space-3);
    border-radius: var(--radius);
    background: var(--warn-tint);
  }

  // Kept in the page, so the region is there before its words; taking no room, and no gap.
  &:not(.shown) {
    @include visually-hidden;
  }

  svg {
    @include icon;

    font-size: var(--icon-sm);
  }
}

.spoken {
  @include visually-hidden;
}

.text :deep(textarea) {
  // Five lines, and a longer text scrolls inside the field: the sheet does not grow as it is typed
  // (handoff 02, сверка С-4).
  height: calc(var(--text-body) * var(--leading-body) * 5 + var(--space-3) * 2);
  resize: none;
}

.attached {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: var(--text-footnote);
  overflow-wrap: anywhere;
}

.attached-lead {
  color: var(--text);
  font-weight: var(--weight-medium);
}

.clip {
  @include icon;

  font-size: var(--icon-sm);
  margin-top: var(--space-1);
}

.sent {
  @include appear;

  display: grid;
  justify-items: center;
  gap: var(--space-2);
  padding: var(--space-6) 0;
  text-align: center;
}

.circle {
  display: grid;
  place-items: center;
  width: var(--space-8);
  height: var(--space-8);
  border-radius: 50%;
  background: var(--good-tint);
  color: var(--good-ink);

  svg {
    @include icon;

    font-size: var(--icon-md);
  }
}

.sent-title {
  margin: 0;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
}

.sent-body {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.note {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0 0 var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius);

  svg {
    @include icon;

    font-size: var(--icon-sm);
  }
}

.warn {
  background: var(--warn-tint);
  color: var(--warn-ink);
}

.bad {
  background: var(--bad-tint);
  color: var(--bad-ink);
}

.note-title {
  margin: 0;
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
}

.note-body {
  margin: 0;
  font-size: var(--text-footnote);
}
</style>
