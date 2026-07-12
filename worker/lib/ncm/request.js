// NCM HTTP client — vendored from api-enhanced/util/request.js, rewritten for Workers:
//   - axios → fetch (Web standard)
//   - DROPPED: pac-proxy-agent / tunnel / http.Agent / https.Agent (Workers have no Node net)
//   - DROPPED: fs.readFileSync(os.tmpdir() + '/anonymous_token') — shared-account deployment
//     always carries a real MUSIC_U cookie via the NCM_COOKIE secret, so the anonymous fallback
//     path is unreachable and the temp-file dance is moot.
//   - DROPPED: xeapi branch (would need crypto.generateKeyPairSync — see crypto.js)
//   - INJECTED: every upstream request gets X-Real-IP + X-Forwarded-For forged to a random
//     mainland-China residential IP, otherwise music.163.com geo-blocks CF's edge nodes.
//
// Signature matches upstream so modules can call `request(url, data, options)` unchanged.

import CryptoJS from 'crypto-js'
import { weapi, linuxapi, eapi } from './crypto.js'
import { generateRandomChineseIP } from './randomip.js'
import { APP_CONF } from './config.js'

const DOMAIN = APP_CONF.domain
const API_DOMAIN = APP_CONF.apiDomain

const UA = {
  weapi: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  linuxapi: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
  eapi: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}

const SPECIAL_STATUS_CODES = new Set([201, 302, 400, 502, 800, 801, 802, 803])

// --- cookie helpers ----------------------------------------------------------

export function cookieToJson(cookie) {
  if (!cookie) return {}
  const obj = {}
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) obj[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }
  return obj
}

export function cookieObjToString(cookie) {
  return Object.keys(cookie)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(cookie[k])}`)
    .join('; ')
}

/**
 * Pads a caller-supplied cookie with the minimal client-identification fields NCM's weapi
 * surface expects. Skipped when the cookie already has them. Doesn't touch MUSIC_U — that's the
 * caller's responsibility (shared-account deployment: passed in via Worker secret).
 */
function processCookieObject(cookie) {
  const _ntes_nuid = CryptoJS.lib.WordArray.random(32).toString()
  return {
    __remember_me: 'true',
    _ntes_nuid,
    _ntes_nnid: `${_ntes_nuid},${Date.now().toString()}`,
    os: 'pc',
    appver: '3.1.17.204416',
    osver: 'Microsoft-Windows-10-Professional-build-19045-64bit',
    channel: 'netease',
    ...cookie, // caller-supplied fields win (esp. MUSIC_U)
  }
}

// --- the request -------------------------------------------------------------

/**
 * Send one NCM request.
 * @param {string} uri     — NCM internal path, e.g. "/api/cloudsearch/pc"
 * @param {object} data    — request body (will be encrypted per options.crypto)
 * @param {object} options — createOption() output (crypto/cookie/ip/headers/timeout)
 * @returns {Promise<{status:number, body:any, cookie:string[]}>}
 */
export async function createRequest(uri, data = {}, options = {}) {
  const headers = { ...(options.headers || {}) }

  // Always forge a mainland-China residential IP unless caller pinned one. CF edge nodes are
  // overseas; without this NCM returns empty bodies / 403 for most queries. We default here
  // (not just in option.js) so createRequest() is safe to call directly without createOption().
  const ip = options.realIP || options.ip || generateRandomChineseIP()
  headers['X-Real-IP'] = ip
  headers['X-Forwarded-For'] = ip

  let cookie = options.cookie || {}
  if (typeof cookie === 'string') cookie = cookieToJson(cookie)
  cookie = processCookieObject(cookie)
  headers['Cookie'] = cookieObjToString(cookie)

  const csrfToken = cookie.__csrf || ''
  let crypto = options.crypto || 'weapi'
  if (crypto === '') crypto = 'weapi'

  let targetUrl = ''
  let bodyStr = ''
  const contentType = 'application/x-www-form-urlencoded;charset=utf-8'
  headers['Content-Type'] = contentType

  switch (crypto) {
    case 'weapi': {
      headers['Referer'] = DOMAIN
      headers['User-Agent'] = UA.weapi
      const payload = { ...data, csrf_token: csrfToken }
      const enc = weapi(payload)
      targetUrl = DOMAIN + '/weapi/' + uri.slice(5)
      bodyStr = new URLSearchParams(enc).toString()
      break
    }
    case 'linuxapi': {
      headers['User-Agent'] = UA.linuxapi
      const enc = linuxapi({
        method: 'POST',
        url: DOMAIN + uri,
        params: data,
      })
      targetUrl = DOMAIN + '/api/linux/forward'
      bodyStr = new URLSearchParams(enc).toString()
      break
    }
    case 'eapi': {
      headers['User-Agent'] = UA.eapi
      const header = {
        osver: cookie.osver,
        appver: cookie.appver,
        os: cookie.os,
        channel: cookie.channel,
        __csrf: csrfToken,
        requestId: `${Date.now()}_${Math.floor(Math.random() * 1000).toString().padStart(4, '0')}`,
      }
      if (cookie.MUSIC_U) header.MUSIC_U = cookie.MUSIC_U
      const enc = eapi(uri, { ...data, header })
      targetUrl = API_DOMAIN + '/eapi/' + uri.slice(5)
      bodyStr = new URLSearchParams(enc).toString()
      break
    }
    case 'api':
    default: {
      headers['User-Agent'] = UA.weapi
      targetUrl = API_DOMAIN + uri
      bodyStr = new URLSearchParams(data).toString()
      break
    }
  }

  const controller = new AbortController()
  const timeout = options.timeout || 30000
  const timer = setTimeout(() => controller.abort(), timeout)

  let upstream
  try {
    upstream = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: controller.signal,
      redirect: 'manual',
    })
  } catch (e) {
    clearTimeout(timer)
    return { status: 502, body: { code: 502, msg: String(e && e.message || e) }, cookie: [] }
  }
  clearTimeout(timer)

  // set-cookie (Workers expose this via headers.getSetCookie() on modern runtimes; older
  // runtimes only expose it via a 'set-cookie' / 'Set-Cookie' header that's collapsed by the
  // Headers spec — try both).
  let setCookie = []
  if (typeof upstream.headers.getSetCookie === 'function') {
    setCookie = upstream.headers.getSetCookie()
  } else {
    const raw = upstream.headers.get('set-cookie')
    if (raw) setCookie = [raw]
  }
  setCookie = setCookie.map((x) => x.replace(/\s*Domain=[^(;|$)]+;*/g, ''))

  const text = await upstream.text().catch(() => '')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = text
  }
  if (parsed && typeof parsed === 'object' && parsed.code != null) {
    parsed.code = Number(parsed.code)
  }

  let status = (parsed && typeof parsed === 'object' && parsed.code) || upstream.status
  if (parsed && typeof parsed === 'object' && parsed.code && SPECIAL_STATUS_CODES.has(parsed.code)) {
    status = 200
  }
  if (!(status > 100 && status < 600)) status = 400

  return { status, body: parsed, cookie: setCookie }
}
