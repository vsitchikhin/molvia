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
    'Уйдёт всё, что Molvia о вас знает: покупки, траты и их категории, обмены денег, доходы, ' +
    'счета и сверки, ' +
    'оценки и отзывы, выбор в ' +
    'поиске, отметки о визитах, настройки и входы на всех устройствах. Товары, магазины и ' +
    'штрихкоды, которые вы добавили в общий справочник, останутся — без вашего имени. Останется и одно ' +
    'число — сколько человек, пришедших в ту же неделю, удалили свои данные.\n\n' +
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
  /**
   * The rating reminder (MOL-101). Sent without an update, so without the person's language: it
   * is always Russian (Р-7) — the answer to a press already speaks the presser's.
   *
   * The first line is the context the card of «Оценки» has — when and where — because the person
   * is asked about a purchase of a day or more ago and has to remember what it was.
   */
  'remind.yesterday': 'Вчера',
  'remind.dayBefore': 'Позавчера',
  /** Three days and more: an abbreviation, so one form fits every number. */
  'remind.daysAgo': '{n} дн. назад',
  'remind.question': '{when} · {place}\n{name} — как вам?\n1 — плохо, 5 — отлично',
  /**
   * A place with its city, where two items of one reminder name a shop of one name in two cities
   * (MOL-120). The city in the prepositional case, a key per city; one with no key is bracketed.
   */
  'remind.placeIn': '{place} {where}',
  'remind.placeInBrackets': '{place} ({city})',
  'remind.in.Гюмри': 'в Гюмри',
  'remind.in.Ереван': 'в Ереване',
  /** Under the last message of the day, when more items wait than the three asked about. */
  'remind.more': 'Ещё {n} ждут в «Оценках»: {url}',
  /** Written under the question after a press; the scale stays, so a slip is one more press. */
  'rate.done': 'Записали: {score} из 5. Промахнулись — нажмите другую цифру.',
  'rate.failed': 'Не дождался ответа. Нажмите ещё раз через минуту.',
  /** An erased account, or an item gone from the catalogue: nothing a second press could fix. */
  'rate.gone': 'Эту оценку уже не поставить: аккаунта или товара больше нет.',
  /**
   * The switch under the last reminder of the evening (MOL-103, В-2, В-3). The buttons are part of
   * the reminder, so Russian like it; the outcome speaks the presser's language. An outcome begins
   * with its own 🔕 or 🔔: that is where the bot finds it in the text again.
   */
  'remind.stop': '🔕 Не напоминать',
  'remind.resume': '🔔 Вернуть напоминания',
  'remind.stopped': '🔕 Напоминания выключены. Вернуть — кнопкой ниже или в настройках приложения.',
  'remind.resumed': '🔔 Напоминания снова включены.',
  'remind.gone': 'Включать нечего: аккаунта в Molvia больше нет.',
  'remind.switchFailed': 'Не дождался ответа. Нажмите ещё раз через минуту.',
  /**
   * A failure, told to the owner (MOL-143): the first time in a build, then at 10, 100 and 1000
   * there. Russian always — the owner's language is not kept. The kind and the place are the
   * table's own words, a class name and a route's template, and are printed as they are.
   */
  'owner.failure.new': '🔴 Новый сбой · {source}',
  'owner.failure.again': '🟠 Уже {count} раз в этой сборке · {source}',
  'owner.failure.what': '{kind} · {place}',
  'owner.failure.nowhere': 'без маршрута',
  /** The phone's platform, `ios 18 app`, as `platformLine` writes it (MOL-144). */
  'owner.failure.platform': 'Платформа {platform}',
  /** The phone's notices held back past the hour's budget, told once it has room (MOL-144). */
  'owner.failure.muted': '🔕 Скрыто уведомлений о сбоях телефона: {count}',
  /** New fingerprints of the phone the hour's rows had no room for (MOL-144, round 3, В1). */
  'owner.failure.unwritten': '🔕 Не записано новых сбоев телефона: {unwritten} — предел строк часа',
  'owner.failure.build': 'Сборка {build}',
  'owner.failure.buildPrint': 'Сборка {build} · {fingerprint}',
  'owner.failure.more': 'Подробности — make failures',
  /**
   * «Написать разработчику» in the bot (MOL-148). The frame is what the person gets around the
   * owner's reply, in the language of their message (Р-12 of MOL-150); the rest answers a text
   * written as a reply to the bot, in the writer's language, under their message.
   */
  'feedback.frame': 'Ответ на ваше сообщение от {date}:',
  // The bot knows a frame by this very line (`isReplyFrame`, round 2 Г3): a new wording keeps the old
  // one in `FRAME_LAST_LINES` (`feedback.ts`), or every frame already sent stops being one and its answers greet.
  'feedback.howToAnswer': 'Чтобы ответить, ответьте на это сообщение.',
  'feedback.passed': 'Передали разработчику.',
  'feedback.delivered': 'Доставлено.',
  'feedback.deliveredUnmarked':
    'Доставлено, но сервер не записал, каким сообщением: ответ человека на него не найдёт переписку.',
  'feedback.blocked': 'Не дошло: человек заблокировал бота.',
  'feedback.gone': 'Сообщения #fb{thread} больше нет: данные удалены.',
  'feedback.tooLong': 'Слишком длинно: до {max} знаков. Ничего не отправлено.',
  'feedback.invisible':
    'Нечего отправить: в тексте одни невидимые знаки или пустые строки подряд. Ничего не отправлено.',
  'feedback.limited': 'Сегодня сообщений уже много. Напишите завтра.',
  'feedback.textOnly': 'Отвечать можно только текстом.',
  'feedback.failed': 'Не получилось: сервер не ответил. Ответьте ещё раз через минуту.',
  'feedback.notSent': 'Не отправлено: Telegram не принял сообщение. Ответьте ещё раз.',
  'feedback.unknown':
    'Не знаю, дошло ли: связь с Telegram оборвалась. Ответите ещё раз — человек может получить ответ дважды.',
  /**
   * A message to the developer, told to the owner (MOL-148, Р-9 of MOL-150). The kind in the sheet's
   * own words; the tag `#fb{thread}` ends the first line and nothing else may stand after it — the
   * bot reads it back from there when the owner replies, and a test holds that every kind keeps it.
   * The screen, the platform and the code are printed as they were sent: the bot repeats no rule of
   * the app's. The owner's language is not kept, so Russian.
   */
  'owner.feedback.bug': '🐞 Сломалось · #fb{thread}',
  'owner.feedback.idea': '💡 Идея · #fb{thread}',
  'owner.feedback.other': '💬 Другое · #fb{thread}',
  'owner.feedback.continued': '↩️ Продолжение · #fb{thread}',
  'owner.feedback.quote': '> {quote}',
  'owner.feedback.where': 'Экран {route} · {platform} · {locale}',
  'owner.feedback.code': 'Код {code}',
  'owner.feedback.noCode': 'С экрана ошибки, без кода',
  'owner.feedback.builds': 'Страница {page} · API {api}',
  'owner.feedback.noBuild': '—',
} as const

/**
 * What a second language has to carry: every key of the Russian one, and nothing else.
 *
 * The mirror is held by the type checker rather than by a test, which is the whole reason the
 * dictionaries are TypeScript. A test still covers what types cannot see — an empty value, a
 * placeholder left as text, and a substitution present in one language and lost in the other.
 */
export type Dictionary = Record<keyof typeof ru, string>
