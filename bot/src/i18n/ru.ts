/**
 * The bot's own dictionary, Russian first — the rule «not one string of text in the code»
 * holds here exactly as it does in the PWA (MOL-55).
 *
 * `.ts` rather than `.json`, unlike the frontend: there Vite loads the file, here the module is
 * read by `tsx` and bundled by esbuild, where a JSON import in ESM wants import attributes. The
 * keys become a type as a result, which is what makes the two languages mirror each other
 * without a test having to say so.
 *
 * Flat keys with dots, again unlike the frontend: vue-i18n resolves nested objects and this
 * does not, so one object is the honest shape.
 */
export const ru = {
  /**
   * The message the whole epic exists for. The code in a link is not a secret, so the person is
   * asked — by a bot that names the device and when the request was made — rather than being
   * logged in by the mere act of opening the link (MOL-54, «почему кнопка обязательна»).
   *
   * The lifetime is deliberately not printed. `LOGIN_LIFETIME_SECONDS` would then have a second
   * copy in prose: changed to three minutes, this line would say «3 минут», which is not
   * Russian and which nobody would notice. Nothing here is acted on by the clock anyway.
   */
  'login.prompt':
    'Войти в Molvia?\n' +
    'Устройство: {device}\n' +
    'Запрос сделан {when}.\n\n' +
    'Если вход начинали не вы — нажмите «Это не я», ничего не произойдёт.',
  /** A request without a `User-Agent` is an ordinary request; the label is decoration (MOL-53). */
  'login.device_unknown': 'неизвестное устройство',
  'login.when.now': 'меньше минуты назад',
  'login.when.one': 'минуту назад',
  'login.when.few': '{n} минуты назад',
  'login.when.many': '{n} минут назад',
  'login.confirm': 'Войти',
  'login.decline': 'Это не я',
  'login.confirmed': 'Вход подтверждён. Вернитесь в Molvia — приложение узнает вас само.',
  'login.declined': 'Вход отклонён. В аккаунт никто не вошёл.',
  /**
   * Expired, spent, declined, unknown and malformed — one answer for all five, because the
   * difference between them would say how to guess a code (MOL-52, проверка 4).
   */
  'login.unavailable': 'Ссылка больше не действует. Начните вход заново в приложении.',
  'login.failed': 'Не получилось. Попробуйте ещё раз через минуту.',
  'start.greeting':
    'Molvia — что стоит покупать и где.\n\n' +
    'Вход начинается в приложении: {url} — а я пришлю сюда подтверждение.',
} as const

/**
 * What a second language has to carry: every key of the Russian one, and nothing else.
 *
 * The mirror is held by the type checker rather than by a test, which is the whole reason the
 * dictionaries are TypeScript. A test still covers what types cannot see — an empty value, a
 * placeholder left as text, and a substitution present in one language and lost in the other.
 */
export type Dictionary = Record<keyof typeof ru, string>
