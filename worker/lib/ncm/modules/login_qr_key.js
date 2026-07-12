// login_qr_key — request a one-time unikey that subsequent QR create + check calls reference.
// Surfaces the raw upstream body so the worker route can wrap it.
import { createOption } from '../option.js'

export default async function login_qr_key(query, request) {
  const result = await request('/api/login/qrcode/unikey', { type: 3 }, createOption(query))
  return {
    status: 200,
    body: { data: result.body, code: 200 },
    cookie: result.cookie,
  }
}
