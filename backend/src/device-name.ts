import { deviceNameOrNull } from '@molvia/model'

/**
 * Chrome's own shape, and nothing else: every browser built on Chromium carries `Chrome/` too, and
 * tells itself apart only by a token of its own — before it (`SamsungBrowser/`), after it
 * (`OPR/`, `XiaoMi/MiuiBrowser/`) or inside the platform (`; wv)`, an app's WebView). A list of
 * those tokens is never complete (adversarial Б3), so Chrome is named only where the string ends
 * the way Chrome's does, and any other Chromium goes unnamed.
 */
const CHROME = /\(KHTML, like Gecko\) Chrome\/[\d.]+ (?:Mobile )?Safari\/[\d.]+$/

/**
 * A label for confirmation, never a claim about the device's identity.
 *
 * It is what a person reads in the bot before «this was not me», so a wrong word costs more than
 * a missing one (adversarial А2, Б3, В1): iPadOS asks for the desktop site and says «Macintosh»,
 * so Safari there is named for both, and an Android tablet asking for it says «X11; Linux» —
 * Samsung Internet exists on Android alone; a browser that cannot be named for certain leaves the label
 * to the system alone.
 */
export function deviceName(userAgent: string | undefined): string | null {
  if (!userAgent) return null
  const browser = /Edg(?:e|A|iOS)?\//.test(userAgent)
    ? 'Edge'
    : userAgent.includes('YaBrowser/')
      ? 'Yandex Browser'
      : userAgent.includes('SamsungBrowser/')
        ? 'Samsung Internet'
        : /(?:OPR|OPT)\//.test(userAgent)
          ? 'Opera'
          : /(?:Firefox|FxiOS)\//.test(userAgent)
            ? 'Firefox'
            : userAgent.includes('CriOS/') ||
                (CHROME.test(userAgent) && !userAgent.includes('; wv)'))
              ? 'Chrome'
              : userAgent.includes('Chrome/')
                ? null
                : /Version\/.*Safari\//.test(userAgent)
                  ? 'Safari'
                  : null
  const os = userAgent.includes('iPhone')
    ? 'iPhone'
    : userAgent.includes('iPad')
      ? 'iPad'
      : userAgent.includes('Android') || browser === 'Samsung Internet'
        ? 'Android'
        : userAgent.includes('Windows')
          ? 'Windows'
          : /Macintosh|Mac OS X/.test(userAgent)
            ? browser === 'Safari'
              ? 'Mac / iPad'
              : 'Mac'
            : userAgent.includes('Linux')
              ? 'Linux / Android'
              : null
  if (!os) return null
  return deviceNameOrNull(browser ? `${os} · ${browser}` : os)
}
