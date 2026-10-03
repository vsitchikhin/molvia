<template>
  <BottomSheet :open="sheet.shown" @update:open="sheet.shown = $event">
    <template #title>{{ fromError ? t('feedback.title_error') : t('feedback.title') }}</template>

    <!-- There before its words, with only the text changing: a region born together with what it
         says is often not read at all (MOL-19). -->
    <p class="offline" :class="{ shown: offlineWords !== '' }" role="status">
      <IconCloud v-if="offlineWords" aria-hidden="true" />{{ offlineWords }}
    </p>

    <div v-if="phase === 'sent'" class="sent" role="status">
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
      <div v-if="phase === 'limited'" class="note warn" role="status">
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
import { useRoute } from 'vue-router'
import { ApiError } from '@molvia/client'
import {
  ERROR,
  FEEDBACK_TEXT_MAX,
  feedbackBodySchema,
  feedbackPlatformSchema,
  pickLocale,
  tidyText,
} from '@molvia/model'
import type { FEEDBACK_SYSTEMS, FeedbackBody, FeedbackKind } from '@molvia/model'
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
import SegmentedControl from '@/components/SegmentedControl.vue'
import { newId } from '@/ids'
import { platformLine } from '@/platform'
import { usePwaUpdate } from '@/pwaUpdate'
import { useActorStore } from '@/stores/actor'
import { dropFeedbackDraft, keepFeedbackDraft, recallFeedbackDraft } from '@/stores/feedbackDraft'
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

const PLACEHOLDER_KEYS: Record<FeedbackKind | '', string> = {
  '': 'feedback.placeholder.any',
  bug: 'feedback.placeholder.bug',
  idea: 'feedback.placeholder.idea',
  other: 'feedback.placeholder.any',
}

/**
 * - `limited` — the day's ten are sent (`429`): held while the sheet is open, since the window is
 *   the server's rolling day and the phone cannot know when it frees; the next opening asks again.
 * - `failed` — no answer, or one that is not a write: the text stays, and «Повторить» sends the same
 *   message by the same key until the person changes it (Р-2).
 */
type Phase = 'idle' | 'sending' | 'sent' | 'limited' | 'failed'

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
    const sheet = useFeedbackSheetStore()
    const actor = useActorStore()
    const update = usePwaUpdate()

    const kind = ref<FeedbackKind | ''>('')
    const text = ref('')
    const clientKey = ref(newId())
    const phase = ref<Phase>('idle')
    const unsupported = ref(false)
    const connected = ref(navigator.onLine)
    const kinds = ref<{ $el?: HTMLElement } | null>(null)
    const field = ref<{ $el?: HTMLElement } | null>(null)

    /** What the opening attaches: the screen it was opened over, the build, the platform, the code. */
    const context = ref({
      route: '',
      screen: '',
      pageBuild: null as string | null,
      platform: '',
      code: null as string | null,
    })
    const fromError = computed(() => sheet.entry.from === 'error')

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
        context.value = {
          route: typeof route.name === 'string' ? route.name : '',
          screen: t(route.meta.titleKey),
          pageBuild: update.build(),
          platform: platformLine(),
          code: entry.from === 'error' ? entry.code : null,
        }
        connected.value = navigator.onLine
        phase.value = 'idle'
        unsupported.value = false
        const draft = recallFeedbackDraft(actor.id)
        recalling = true
        kind.value = entry.from === 'error' ? 'bug' : (draft?.kind ?? '')
        text.value = draft?.text ?? ''
        clientKey.value = draft?.clientKey ?? newId()
        await nextTick()
        recalling = false
        // A changed kind — «Сломалось» over a draft of an idea — is new content, with a key of its own.
        if (draft !== null && kind.value !== draft.kind) changed()
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

    function changed(): void {
      clientKey.value = newId()
      keepFeedbackDraft(actor.id, {
        kind: kind.value,
        text: text.value,
        clientKey: clientKey.value,
      })
    }

    watch([kind, text], () => {
      if (recalling) return
      changed()
      unsupported.value = false
      // An edit is the answer to «не получилось»; the day's limit it does not lift.
      if (phase.value === 'failed') phase.value = 'idle'
    })

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

    const attachedWords = computed(() => {
      const { pageBuild, screen, platform, code } = context.value
      return [
        pageBuild === null ? null : t('feedback.attached_build', { build: pageBuild }),
        t('feedback.attached_screen', { screen }),
        platformWords(platform),
        code === null ? null : t('feedback.attached_code', { code }),
      ]
        .filter((part) => part !== null && part !== '')
        .join(' · ')
    })

    const body = computed(() => {
      if (kind.value === '') return null
      const { route: name, pageBuild, platform, code } = context.value
      const parsed = feedbackBodySchema.safeParse({
        kind: kind.value,
        text: tidyText(text.value),
        locale: pickLocale(locale.value),
        pageBuild,
        route: name,
        platform,
        fromError: fromError.value,
        errorCode: code,
        clientKey: clientKey.value,
      } satisfies Record<keyof FeedbackBody, unknown>)
      return parsed.success ? parsed.data : null
    })

    /** Why the button does not send, if it does not — `null` when it does. */
    const waiting = computed<string | null>(() => {
      if (phase.value === 'sent' || phase.value === 'sending') return null
      if (kind.value === '') return t('feedback.need_kind')
      if (tidyText(text.value).trim() === '') return t('feedback.need_text')
      if (phase.value === 'limited') return t('feedback.need_tomorrow')
      if (!connected.value) return t('feedback.need_network')
      return null
    })

    const action = computed<{ words: string; icon: Component | null }>(() => {
      if (phase.value === 'sent') return { words: t('feedback.done'), icon: IconCheck }
      if (phase.value === 'sending') return { words: t('feedback.sending'), icon: null }
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
      const message = body.value
      if (message === null) {
        // A kind and a text that draws something are there, and still the schema refuses: a
        // character that cannot be sent — said under the field rather than left to a grey button.
        unsupported.value = true
        return
      }
      const mine = opening
      const owner = actor.id
      phase.value = 'sending'
      try {
        await api.sendFeedback(message)
        // Sent is sent, whatever became of the sheet meanwhile: the draft goes with it — unless it
        // has changed since, and is another message now.
        dropFeedbackDraft(owner, message.clientKey)
        if (mine !== opening) return
        phase.value = 'sent'
      } catch (error) {
        if (mine !== opening) return
        const code = error instanceof ApiError ? error.code : null
        connected.value = navigator.onLine
        if (code === ERROR.FEEDBACK_RATE_LIMITED) {
          phase.value = 'limited'
          return
        }
        // The same key with another content — a defect of the phone, never the person's (Р-2): a
        // new key, or «Повторить» would meet the same refusal for ever (сверка С-9).
        if (code === ERROR.CONFLICT) changed()
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
      waiting,
      action,
      press,
      textMax: FEEDBACK_TEXT_MAX,
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
    flex: none;
    width: var(--space-6);
    height: var(--space-6);
  }
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
  flex: none;
  width: var(--space-4);
  height: var(--space-4);
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
    width: var(--space-6);
    height: var(--space-6);
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
    flex: none;
    width: var(--space-6);
    height: var(--space-6);
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
