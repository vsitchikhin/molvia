import { createI18n } from 'vue-i18n'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'

// Not a single string lives in the markup. The plan is to reach other languages without
// rebranding, and hardcoded text is the cheapest mistake today and the dearest one later.
export const i18n = createI18n({
  legacy: false,
  locale: navigator.language.startsWith('ru') ? 'ru' : 'en',
  fallbackLocale: 'en',
  messages: { en, ru },
})
