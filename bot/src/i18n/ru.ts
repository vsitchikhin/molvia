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
   * **Asked from the account owner's side, and the consequence is named** (MOL-55, З-2, owner's
   * decision 24.09.2026). «Войти в Molvia?» over a button labelled «Войти» reads as «log *me*
   * in», which is exactly the wrong way round for the one attack this message exists to stop: a
   * stranger starts a login of their own, sends you their link under any pretext, and your tap
   * puts **their** browser inside **your** account — with purchases the product otherwise keeps
   * private. The device and the age of the request were already here and did not help: nobody
   * expects the device named to be their own when the question sounds like it is about them.
   *
   * The lifetime is deliberately not printed. `LOGIN_LIFETIME_SECONDS` would then have a second
   * copy in prose: changed to three minutes, this line would say «3 минут», which is not
   * Russian and which nobody would notice. Nothing here is acted on by the clock anyway.
   */
  'login.prompt':
    'Впустить это устройство в ваш аккаунт Molvia?\n' +
    'Устройство: {device}\n' +
    'Запрос сделан {when}.\n\n' +
    'Если вход начинали не вы — нажмите «Это не я»: иначе тот, кто прислал ссылку, ' +
    'получит доступ к вашим покупкам.',
  /** A request without a `User-Agent` is an ordinary request; the label is decoration (MOL-53). */
  'login.device_unknown': 'неизвестное устройство',
  'login.when.now': 'меньше минуты назад',
  'login.when.one': 'минуту назад',
  'login.when.few': '{n} минуты назад',
  'login.when.many': '{n} минут назад',
  'login.confirm': 'Войти',
  'login.decline': 'Это не я',
  'login.confirmed': 'Вход подтверждён. Вернитесь в Molvia — приложение узнает вас само.',
  /**
   * The answer to opening a link that has already been confirmed and not yet collected.
   *
   * Told apart from a dead link on purpose, and it is the only place where telling two
   * outcomes apart is worth more than one answer for all of them: what the person did next
   * after «не дождался ответа» was open the link again, and «начните вход заново» over a
   * session already granted was the second lie in a row (MOL-55, О-2).
   *
   * **And it offers «Это не я», because the bot cannot tell who confirmed** (adversarial Б1).
   * `confirmed` says that, not by whom (Р-11), so this sentence reaches two people: the one who
   * just pressed the button, and the victim of the other direction of Р-7 — their link leaked,
   * a stranger confirmed it from their own Telegram, and the victim's browser is about to
   * collect a session of **somebody else's** account. Saying «вернитесь, приложение узнает вас
   * само» to the second one is pure reassurance at the worst possible moment; before О-2 they
   * at least got a confusing «ссылка больше не действует» and started over. The API can still
   * put such a request out — `decline` works on a confirmed one until it is collected — and the
   * button is the only way to reach that path.
   */
  'login.already':
    'Этот вход уже подтверждён — вернитесь в Molvia.\n\n' +
    'Если подтверждали не вы, нажмите «Это не я»: иначе приложение откроет чужой аккаунт, ' +
    'а не ваш.',
  'login.declined': 'Вход отклонён. В аккаунт никто не вошёл.',
  /**
   * Expired, spent, declined, unknown and malformed — one answer for all five, because the
   * difference between them would say how to guess a code (MOL-52, проверка 4).
   */
  'login.unavailable': 'Ссылка больше не действует. Начните вход заново в приложении.',
  /**
   * «Did not work» was too strong a thing to say: the API may well have written the
   * confirmation and lost only the answer on the way back (О-2). What is certainly true is
   * that we did not hear anything — and that is what this now says.
   */
  'login.failed': 'Не дождался ответа. Попробуйте ещё раз через минуту.',
  'start.greeting':
    'Molvia — что стоит покупать и где.\n\n' +
    'Вход начинается в приложении: {url} — а я пришлю сюда подтверждение.\n\n' +
    'Удалить все свои данные — /delete.',
  /**
   * The person erasing themselves (MOL-58). What stays is named as plainly as what goes: the
   * catalogue keeps the items they added and every shop they named (adversarial О-5), and
   * hearing that afterwards would feel like a lie. What goes is «everything», not a list: a
   * list of four left out the search picks and the visit marks the privacy page names.
   */
  'erase.prompt':
    'Удалить все ваши данные в Molvia?\n\n' +
    'Уйдёт всё, что Molvia о вас знает: покупки, обмены денег, оценки и отзывы, выбор в ' +
    'поиске, отметки о визитах, настройки и входы на всех устройствах. Товары и магазины, ' +
    'которые вы добавили в общий справочник, останутся — без вашего имени.\n\n' +
    'Отменить это нельзя.',
  'erase.confirm': 'Удалить навсегда',
  'erase.cancel': 'Отмена',
  /**
   * One sentence for «erased» and «there was nothing to erase», because a double tap produces
   * both — the second press finds nobody — and the second must not overwrite the first with
   * something that sounds different. This one is true either way.
   *
   * And it speaks for the server only: the app keeps its last answers and unsent entries on the
   * phone, where nothing on the server can reach them (selfreview 3) — so the person is told how.
   */
  'erase.done':
    'Готово: ваших данных в Molvia нет. Войти снова можно — это будет новый пустой аккаунт.\n\n' +
    'На телефоне могли остаться сохранённые копии: чтобы убрать их, удалите приложение ' +
    'или очистите данные сайта в браузере.',
  /**
   * Never written into the question: shown over it, or under it when Telegram will not take the
   * alert (П-4). True whichever button came first — the bot cannot know whether «Удалить
   * навсегда» was already pressed (adversarial О-2).
   */
  'erase.cancelled': 'Кнопки убраны. Если «Удалить навсегда» уже нажата, удаление не отменить.',
  /** A prompt answered long after it was sent is not the «yes» it was asking for. */
  'erase.expired': 'Эта кнопка устарела. Отправьте /delete ещё раз.',
  'erase.failed': 'Не дождался ответа. Попробуйте ещё раз через минуту.',
} as const

/**
 * What a second language has to carry: every key of the Russian one, and nothing else.
 *
 * The mirror is held by the type checker rather than by a test, which is the whole reason the
 * dictionaries are TypeScript. A test still covers what types cannot see — an empty value, a
 * placeholder left as text, and a substitution present in one language and lost in the other.
 */
export type Dictionary = Record<keyof typeof ru, string>
