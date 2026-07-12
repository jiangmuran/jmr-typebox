// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ALLOWED_MODULES, call } from '../../lib/ncm/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MODULES_DIR = join(__dirname, '../../lib/ncm/modules')

// The privacy posture of this deployment: the NCM_COOKIE secret belongs to a shared VIP account,
// so we deliberately DO NOT expose any module that reads private account data. If you ever add a
// module to worker/lib/ncm/modules/, you must:
//   1. Add its filename to EXPECTED below.
//   2. Add it to the imports array in worker/lib/ncm/index.js.
//   3. Re-read whether the module is appropriate for the shared-account posture.
// This test fails LOUDLY if a module file appears that isn't on the allowlist.
const EXPECTED = new Set([
  'cloudsearch.js',
  'playlist_detail.js',
  'playlist_track_all.js',
  'song_detail.js',
  'song_url.js',
  'lyric_new.js',
  'album.js',
  'artist_songs.js',
  'login_qr_key.js',
  'login_qr_create.js',
  'login_qr_check.js',
  'user_detail.js',
])

// Modules we MUST NEVER vendor. If any of these files ever shows up in modules/, this test fails
// — a circuit-breaker against accidentally widening the surface.
const FORBIDDEN_PATTERNS = [
  /user_playlist/,
  /recommend_?songs?/,
  /personal_?fm/,
  /user_cloud/,
  /daily_signin/,
  /record\.js$/,           // play history
  /history/,
  /likelist|like_list/,    // 红心列表
  /playlist_subscribe/,    // 收藏
  /cellphone_login|login_?(cellphone|email|password|captcha)/, // password-style logins (we only do QR)
  /user_?dj/,
]

describe('bundle privacy allowlist', () => {
  it('exports exactly the expected 12 module names', () => {
    expect(ALLOWED_MODULES.size).toBe(12)
    for (const name of EXPECTED) {
      // allow camelCase round-trip
      const camel = name.replace(/_([a-z])/g, (_, c) => c.toUpperCase()).replace(/\.js$/, '')
      const ok = ALLOWED_MODULES.has(camel) || ALLOWED_MODULES.has(name.replace(/\.js$/, ''))
      expect(ok, `module ${name} not exported`).toBe(true)
    }
  })

  it('contains ONLY the expected .js files (no drift)', () => {
    const files = readdirSync(MODULES_DIR).filter((f) => f.endsWith('.js'))
    for (const f of files) {
      expect(EXPECTED.has(f), `unexpected file in modules/: ${f}`).toBe(true)
    }
    // And nothing missing.
    for (const expected of EXPECTED) {
      expect(files.includes(expected), `expected file missing: ${expected}`).toBe(true)
    }
  })

  it('does NOT vendor any forbidden private-data module', () => {
    const files = readdirSync(MODULES_DIR)
    for (const f of files) {
      for (const pat of FORBIDDEN_PATTERNS) {
        expect(pat.test(f), `forbidden module vendored: ${f} (matched ${pat})`).toBe(false)
      }
    }
  })

  it('call() throws for unknown module names (no silent fallback)', () => {
    expect(() => call('userPlaylist', {})).toThrow(/not allowed/)
    expect(() => call('recommendSongs', {})).toThrow(/not allowed/)
    expect(() => call('personalFm', {})).toThrow(/not allowed/)
  })
})
