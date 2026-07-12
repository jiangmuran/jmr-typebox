// NCM client facade — binds the 12 vendored modules to the fetch-based createRequest, and
// exports a flat `call.<name>(query)` API the worker routes can invoke directly.
//
// We deliberately surface ONLY the modules imported below. If you ever need to add a module
// here, first re-read the privacy posture in the project plan: anything that reads private
// account state (user_playlist / recommend_songs / personal_fm / record / cloud / history /
// daily_signin) is OUT OF SCOPE for the shared-account deployment, and the bundle-allowlist
// test (worker/__tests__/ncm/allowlist.test.js) will fail loudly if one slips in.

import { createRequest, cookieToJson } from './request.js'
import { generateRandomChineseIP } from './randomip.js'

import cloudsearch from './modules/cloudsearch.js'
import playlistDetail from './modules/playlist_detail.js'
import playlistTrackAll from './modules/playlist_track_all.js'
import songDetail from './modules/song_detail.js'
import songUrl from './modules/song_url.js'
import lyricNew from './modules/lyric_new.js'
import album from './modules/album.js'
import artistSongs from './modules/artist_songs.js'
import loginQrKey from './modules/login_qr_key.js'
import loginQrCreate from './modules/login_qr_create.js'
import loginQrCheck from './modules/login_qr_check.js'
import userDetail from './modules/user_detail.js'

// Each module is `(query, request) => Promise<answer>`. We bind `request` to our createRequest
// here so the route layer doesn't have to thread it through. Callers only pass `query`.
const modules = {
  cloudsearch,
  playlistDetail,
  playlistTrackAll,
  songDetail,
  songUrl,
  lyricNew,
  album,
  artistSongs,
  loginQrKey,
  loginQrCreate,
  loginQrCheck,
  userDetail,
}

// The allowlist the bundle test asserts against. Update BOTH this set AND the imports above
// if you ever extend the surface (rare; see header).
export const ALLOWED_MODULES = new Set(Object.keys(modules))

export function call(name, query = {}) {
  const fn = modules[name]
  if (!fn) throw new Error(`ncm module not allowed: ${name}`)
  return fn(query, createRequest)
}

export { cookieToJson, generateRandomChineseIP }
