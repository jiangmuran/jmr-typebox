// lyric_new — full lyrics bundle: original (lrc), translation (tlyric), romaji (romalrc),
// and per-syllable KTV timing (yrc). One call returns all four; clients pick which to render.
import { createOption } from '../option.js'

export default function lyric_new(query, request) {
  const data = {
    id: query.id,
    cp: false,
    tv: 0, lv: 0, rv: 0, kv: 0, yv: 0, ytv: 0, yrv: 0,
  }
  return request('/api/song/lyric/v1', data, createOption(query))
}
