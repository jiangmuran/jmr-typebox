// Per-request options carried through every NCM module. Mirrors api-enhanced/util/option.js —
// a module returns createOption(query, crypto?) and the request layer picks the crypto scheme
// (weapi / eapi / linuxapi / api) + cookie + IP from it.
//
// Defaults intentionally diverge from upstream in ONE place: `realIP` defaults to a fresh random
// Chinese IP on every call, because Workers run on overseas edge nodes (see randomip.js).

import { generateRandomChineseIP } from './randomip.js'

export function createOption(query = {}, crypto = '') {
  const opts = {
    crypto,
    cookie: query.cookie || {},
    headers: query.headers || {},
    proxy: '',          // unused — Workers have no Node http.Agent / tunnel
    ip: query.realIP || query.ip || generateRandomChineseIP(),
    realIP: query.realIP || query.ip || generateRandomChineseIP(),
    // 30s upstream timeout (matches our worker convention for non-streaming JSON calls).
    timeout: 30000,
  }
  // Allow callers to override the default crypto via the option's second arg only.
  if (!opts.crypto) opts.crypto = 'weapi'
  return opts
}
