// login_qr_check — poll the QR-code login state. Returns one of:
//   code 800 — key expired (frontend should request a new unikey)
//   code 801 — waiting for scan
//   code 802 — scanned, awaiting user confirmation in the NCM app
//   code 803 — confirmed; the response carries the freshly-minted MUSIC_U cookie, which we
//              surface as a joined string for the worker route to encrypt + persist.
//
// NOTE: upstream's catch-branch references `result.cookie` outside its scope — we return an
// empty cookie array on error instead.
import { createOption } from '../option.js'

export default async function login_qr_check(query, request) {
  const data = { key: query.key, type: 3 }
  try {
    const result = await request('/api/login/qrcode/client/login', data, createOption(query))
    return {
      status: 200,
      body: { ...result.body, cookie: (result.cookie || []).join(';') },
      cookie: result.cookie,
    }
  } catch (error) {
    return { status: 200, body: { code: 502, msg: String(error && error.message || error) }, cookie: [] }
  }
}
